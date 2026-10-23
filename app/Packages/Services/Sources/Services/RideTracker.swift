import Foundation
import Observation
import Models

/// The rider's tracked ride (docs/ride-tracking-api.md): one active plan per account, saved from a
/// pick's `recommendationRef` and compared with the latest forecast whenever the rider checks.
/// API v0.28.0 has no background checks or notifications, so `notifies` stays false until it does.
@MainActor @Observable
public final class RideTracker {
    /// The active plan, or `nil`.
    public private(set) var ride: TrackedRide?
    /// The API's `capabilities.notifications`. While it's false the app mustn't promise alerts.
    public private(set) var notifies = false

    private let isLive: Bool
    private var version = 0
    /// `refresh.refreshAt`: until then the last comparison still stands. `nil` means check now.
    private var nextCheck: Date?
    /// A create that never got an answer, so trying again reuses its idempotency key.
    private var unsent: (body: Create, key: String)?

    /// Live: talks to the API. Otherwise the plan lives in memory and checks never change.
    public init(live: Bool) {
        isLive = live
    }

    /// Account changes clear the bell and any pending replacement before another login loads.
    public func clearAccount() {
        ride = nil
        nextCheck = nil
        version = 0
        notifies = false
        unsent = nil
    }

    /// Whether the API saved `pick` for tracking.
    public func canTrack(_ pick: RideBoard.Pick) -> Bool {
        !isLive || pick.recommendationRef != nil
    }

    /// Reads the active plan. GETs never fetch weather; `refreshIfDue` does.
    public func load() async {
        guard isLive, RideOnAPI.isSignedIn else { return }
        do {
            let list: List = try await RideOnAPI.send("/tracked-rides")
            version = list.trackingVersion
            notifies = list.capabilities?.notifications ?? false
            guard let id = list.activeTrackedRideId else { ride = nil; return }
            apply(try await RideOnAPI.send("/tracked-rides/\(id)"))
        } catch {
            // ponytail: a failed read keeps what's on screen; the next board load tries again.
        }
    }

    /// Tracks `pick`, replacing any other plan. The caller confirms the replacement first.
    public func track(_ pick: RideBoard.Pick) async throws {
        guard isLive else {
            ride = TrackedRide(id: UUID().uuidString, routeId: pick.route.id, start: pick.start, finish: pick.finish,
                               originalScore: pick.score, latestScore: pick.score, check: .checked(at: .now, changes: []))
            return
        }
        guard let ref = pick.recommendationRef else { throw Self.expired }
        let body = Create(recommendationRef: ref, expectedTrackingVersion: version, replaceTrackedRideId: ride?.id)
        let key = unsent.flatMap { $0.body == body ? $0.key : nil } ?? UUID().uuidString
        unsent = (body, key)
        do {
            let detail: Detail = try await RideOnAPI.send("/tracked-rides", headers: ["Idempotency-Key": key], body: body)
            unsent = nil
            // A replayed action can return an older plan; `activeTrackedRideId` names the current one.
            if detail.activeTrackedRideId == detail.ride.id { apply(detail) } else { await load() }
        } catch let failure as RideOnAPI.Failure {
            unsent = nil
            switch failure.code {
            case "TRACKING_VERSION_CONFLICT":
                await load()
                throw RideOnAPI.Failure(status: failure.status, code: failure.code,
                                        message: "Your tracked ride changed on another device. Check it and try again.")
            case "RECOMMENDATION_UNAVAILABLE": throw Self.expired
            default: throw failure
            }
        }
    }

    /// Stops tracking. Stopping twice is harmless.
    public func stop() async throws {
        guard let id = ride?.id else { return }
        if isLive { try await RideOnAPI.send("/tracked-rides/\(id)", method: "DELETE") }
        ride = nil
        nextCheck = nil
        await load()
    }

    /// Compares the latest forecast with the saved one, unless the last comparison still stands.
    public func refreshIfDue() async {
        guard isLive, let current = ride, current.check != .closed, nextCheck.map({ $0 <= .now }) ?? true else { return }
        ride?.check = .checking
        for attempt in 1...3 {
            do {
                let detail: Detail = try await RideOnAPI.send("/tracked-rides/\(current.id)/refresh", method: "POST")
                // The rider's settings or routes changed mid-check, so its result was thrown away.
                if detail.ride.refresh.reasonCode == "inputs_changed", attempt < 3 { continue }
                apply(detail)
                return
            } catch let failure as RideOnAPI.Failure where failure.code == "REFRESH_IN_PROGRESS" && attempt < 3 {
                try? await Task.sleep(for: .seconds(failure.retryAfter ?? 5))
            } catch let failure as RideOnAPI.Failure where ["REFRESH_CLOSED", "TRACKING_INACTIVE", "TRACKED_RIDE_NOT_FOUND"].contains(failure.code) {
                await load()
                return
            } catch where Task.isCancelled {
                ride?.check = current.check
                return
            } catch {
                ride?.check = .failed(.other, lastChecked: current.check.lastChecked)
                return
            }
        }
    }

    private static let expired = RideOnAPI.Failure(status: 422, code: "RECOMMENDATION_UNAVAILABLE",
                                                   message: "This forecast has expired. Refresh Rides and try again.")

    private func apply(_ detail: Detail) {
        version = detail.trackingVersion
        if let notifications = detail.ride.capabilities?.notifications { notifies = notifications }
        guard detail.ride.state == "active", detail.activeTrackedRideId == detail.ride.id else { ride = nil; return }
        ride = Self.trackedRide(detail.ride)
        nextCheck = detail.ride.refresh.refreshAt
    }

    // MARK: Mapping

    nonisolated static func trackedRide(_ ride: Ride) -> TrackedRide {
        let refresh = ride.refresh
        let original = Int(ride.baseline.pick.candidate.score.rounded())
        let latest = ride.latestAssessment.map { Int($0.pick.candidate.score.rounded()) }
        let check: TrackedRide.Check =
            if refresh.closed || ride.state != "active" { .closed }
            else if refresh.result == "in_progress" { .checking }
            else if let comparison = ride.comparison, let assessment = ride.latestAssessment {
                .checked(at: refresh.lastSuccessfulAssessmentAt ?? .now, changes: changes(comparison, from: ride.baseline, to: assessment))
            }
            else if refresh.result == "unavailable" { .failed(reason(refresh.reasonCode), lastChecked: refresh.lastSuccessfulAssessmentAt) }
            else { .due(lastChecked: refresh.lastSuccessfulAssessmentAt) }
        return TrackedRide(id: ride.id, routeId: ride.routeId, start: ride.departureAt, finish: ride.finishAt,
                           originalScore: original, latestScore: latest, check: check)
    }

    nonisolated static func changes(_ comparison: Comparison, from baseline: Snapshot, to latest: Snapshot) -> [TrackedRide.Change] {
        var changes: [TrackedRide.Change] = comparison.standards.newlyFailing.compactMap { failure in
            standard(failure.standard).map { .standard($0, actual: failure.actual, limit: failure.limit) }
        }
        let rainy = { (snapshot: Snapshot) in
            snapshot.pick.candidate.conditions?.precipitationSummary.map { $0 != "dry" && $0 != "possible" } ?? false
        }
        let rainFailed = changes.contains {
            if case .standard(.rainChance, _, _) = $0 { true } else if case .standard(.rainRate, _, _) = $0 { true } else { false }
        }
        if rainy(latest), !rainy(baseline), !rainFailed { changes.append(.rain) }
        let best = comparison.bestPick
        if best.routeStillRecommended == false {
            let name = latest.context.routes.first { $0.id == best.bestKnown.routeId }?.name
            changes.append(.betterRoute(name: name, start: best.bestKnown.departureAt))
        } else if best.departureStillRecommended == false {
            changes.append(.betterTime(start: best.bestKnown.departureAt))
        }
        let delta = Int(latest.pick.candidate.score.rounded()) - Int(baseline.pick.candidate.score.rounded())
        if delta != 0 { changes.append(.score(delta)) }
        if best.coverage == "incomplete", best.routeStillRecommended == nil { changes.append(.incomplete) }
        return changes
    }

    nonisolated private static func standard(_ name: String) -> TrackedRide.Standard? {
        switch name {
        case "maximumGustKph": .gust
        case "minimumTemperatureC": .cold
        case "maximumTemperatureC": .heat
        case "maximumPrecipitationProbability": .rainChance
        case "maximumPrecipitationRateMmH": .rainRate
        default: nil
        }
    }

    nonisolated private static func reason(_ code: String?) -> TrackedRide.Reason {
        switch code {
        case "route_unavailable": .routeUnavailable
        case "pinned_departure_no_longer_fits": .noLongerFits
        case "forecast_unavailable": .forecastUnavailable
        case "missing_elevation": .missingElevation
        default: .other
        }
    }

    // MARK: Wire

    struct Create: Encodable, Equatable {
        var recommendationRef: String
        var expectedTrackingVersion: Int
        /// Encoded as `null` when there's nothing to replace.
        var replaceTrackedRideId: String?

        enum CodingKeys: CodingKey { case recommendationRef, expectedTrackingVersion, replaceTrackedRideId }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(recommendationRef, forKey: .recommendationRef)
            try container.encode(expectedTrackingVersion, forKey: .expectedTrackingVersion)
            try container.encode(replaceTrackedRideId, forKey: .replaceTrackedRideId)
        }
    }

    struct Capabilities: Decodable { var notifications: Bool }

    struct List: Decodable {
        var trackingVersion: Int
        var activeTrackedRideId: String?
        var capabilities: Capabilities?
    }

    /// `GET /tracked-rides/{id}`, refresh, and create (which adds `outcome`).
    struct Detail: Decodable {
        var ride: Ride
        var trackingVersion: Int
        var activeTrackedRideId: String?
    }

    struct Ride: Decodable {
        var id: String
        var routeId: UUID
        var departureAt: Date
        var finishAt: Date
        var state: String
        var baseline: Snapshot
        var latestAssessment: Snapshot?
        var comparison: Comparison?
        var refresh: Refresh
        var capabilities: Capabilities?
    }

    struct Snapshot: Decodable {
        struct Context: Decodable {
            struct Route: Decodable { var id: UUID; var name: String? }
            var routes: [Route]
        }
        struct Pick: Decodable {
            struct Candidate: Decodable {
                struct Conditions: Decodable { var precipitationSummary: String? }
                var score: Double
                var conditions: Conditions?
            }
            var routeId: UUID
            var candidate: Candidate
        }
        var context: Context
        var pick: Pick
    }

    struct Comparison: Decodable {
        struct Standards: Decodable {
            struct Failure: Decodable { var standard: String; var limit: Double; var actual: Double }
            var newlyFailing: [Failure]
        }
        struct BestPick: Decodable {
            struct Known: Decodable { var routeId: UUID; var departureAt: Date }
            var coverage: String
            var routeStillRecommended: Bool?
            var departureStillRecommended: Bool?
            var bestKnown: Known
        }
        var standards: Standards
        var bestPick: BestPick
    }

    struct Refresh: Decodable {
        var result: String
        var reasonCode: String?
        var lastSuccessfulAssessmentAt: Date?
        var refreshAt: Date?
        var closed: Bool
    }
}

import Foundation
import Models
import Engine

/// Network, JSON, geometry and atomic cache writes run on this actor, never the UI actor.
actor RideBoardRepository {
    typealias Fetch = @Sendable (String, Data?, String) async throws -> Data
    static let shared = RideBoardRepository()
    private let directory: URL
    private let fetch: Fetch
    private let now: @Sendable () -> Date
    private let sessionIsCurrent: @Sendable (String) -> Bool
    private var generation = UUID()
    private var cached: RideBoardSnapshot?

    init(directory: URL = URL.cachesDirectory.appending(path: "RideBoards"),
         now: @escaping @Sendable () -> Date = { .now },
         sessionIsCurrent: @escaping @Sendable (String) -> Bool = { RideOnSession.shared.credentials?.id == $0 },
         fetch: @escaping Fetch = { try await RideOnAPI.data($0, method: $2, body: $1) }) {
        self.directory = directory
        self.now = now
        self.sessionIsCurrent = sessionIsCurrent
        self.fetch = fetch
    }

    private func file(_ account: String) -> URL {
        directory.appending(path: RideBoardSnapshot.hash(Data(account.utf8)) + ".json")
    }

    func restore(session: String, account: String?) -> RideBoardContent? {
        guard let account, sessionIsCurrent(session) else { return nil }
        let started = ContinuousClock.now
        defer { LoadingLog.logger.debug("Board cache restoration: \(String(describing: started.duration(to: .now)), privacy: .public)") }
        if let cached, cached.session == session, cached.account == account { return try? RideBoardContent(cached) }
        guard let data = try? Data(contentsOf: file(account)),
              let snapshot = try? JSONDecoder().decode(RideBoardSnapshot.self, from: data),
              snapshot.schemaVersion == RideBoardSnapshot.schema, snapshot.account == account,
              snapshot.session == session, let content = try? RideBoardContent(snapshot) else { return nil }
        cached = snapshot
        return content
    }

    func invalidate(account: String? = nil) {
        generation = UUID()
        if let account { try? FileManager.default.removeItem(at: file(account)) }
        cached = nil
    }

    private func check(_ id: UUID, session: String) throws {
        try Task.checkCancellation()
        guard generation == id, sessionIsCurrent(session) else { throw CancellationError() }
    }

    private func commit(_ snapshot: RideBoardSnapshot, generation id: UUID) throws {
        try check(id, session: snapshot.session)
        cached = snapshot
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(snapshot)
            try check(id, session: snapshot.session)
            try data.write(to: file(snapshot.account), options: .atomic)
            #if os(iOS)
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                                  ofItemAtPath: file(snapshot.account).path)
            #endif
            if !sessionIsCurrent(snapshot.session) { try? FileManager.default.removeItem(at: file(snapshot.account)) }
        } catch is CancellationError { throw CancellationError() }
        catch { LoadingLog.logger.error("Couldn't persist the ride board; keeping the in-memory result.") }
    }

    func refresh(session: String, account: String?, window: RideWindow? = nil, force: Bool = false,
                 update: @escaping @Sendable (RideBoardContent) async -> Void = { _ in }) async throws -> RideBoardSnapshot {
        generation = UUID()
        let id = generation
        _ = restore(session: session, account: account)
        let previous = cached?.session == session ? cached : nil
        async let selectionData = fetch("/route-selection", nil, "GET")
        async let profileData = fetch("/users/me", nil, "GET")
        let selection = try await RideOnAPI.decoder.decode(RideBoardLoader.SelectionResponse.self, from: selectionData).selection
        var profile = try await profileData
        var user = try RideOnAPI.decoder.decode(RideBoardLoader.UserResponse.self, from: profile).user
        try check(id, session: session)
        guard let accountID = user.id, account == nil || account == accountID else { throw CancellationError() }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = user.settings?.timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        if let window {
            let patch = RideBoardLoader.PlanningPatch(expectedVersion: user.version, settings: .init(planning: .init(
                days: window.quickPick.map { .init(kind: "preset", preset: $0.rawValue) } ?? .dates(window.days, calendar: calendar),
                window: .init(window.hours))))
            // A failed save leaves the old board and explains the error; never silently save a different window.
            profile = try await fetch("/users/me", try JSONEncoder().encode(patch), "PATCH")
            user = try RideOnAPI.decoder.decode(RideBoardLoader.UserResponse.self, from: profile).user
        }
        let ids = selection.routeIds
        let hours = window?.hours ?? user.settings?.planning?.window?.hours ?? .daylight
        if ids.isEmpty {
            let snapshot = RideBoardSnapshot(session: session, account: accountID, fetchedAt: now(), profile: profile,
                                             recommendation: nil, routes: [:], summaries: [], hours: hours, contextKey: nil)
            try commit(snapshot, generation: id)
            return snapshot
        }
        let days = window.map { RideBoardLoader.PlanningDays.dates($0.days, calendar: calendar) }
            ?? (user.settings?.planning?.days ?? .init(kind: "preset", preset: "next")).resolved(at: now(), calendar: calendar)
        let body = try JSONEncoder().encode(RideBoardLoader.RecommendationRequest(routeIds: ids, days: days, previewDays: 7, riding: .init(window: .init(hours))))
        let oldRoutes = previous?.routes.filter { ids.contains($0.key) } ?? [:]
        async let routeResult = routes(ids, previous: oldRoutes)
        async let summaryResult: Data? = optional("/rides/summaries", body: try JSONEncoder().encode(RideBoardLoader.SummariesRequest(routeIds: ids)))

        // Only a still-fresh board waits for cheap context validation before deciding to skip ranking.
        if !force, window == nil, let previous, previous.canReuse(at: now()) {
            let routes = try await routeResult
            let summaryData = try await summaryResult
            let key = try context(body: body, profile: profile, selection: selection.version, routes: routes, summaries: summaryData)
            if let key, key == previous.contextKey {
                try check(id, session: session)
                return previous
            }
        }

        let recommendation = try await fetch("/recommendations", body, "POST")
        var snapshot = RideBoardSnapshot(session: session, account: accountID, fetchedAt: now(), profile: profile,
                                         recommendation: recommendation, routes: oldRoutes, summaries: previous?.summaries ?? [],
                                         hours: hours, contextKey: nil)
        // Validate before publishing/persisting. Cached maps can appear while optional enrichment finishes.
        let content = try RideBoardContent(snapshot)
        try check(id, session: session)
        // On the first load, the complete recommendation is already useful without maps.
        // During later refreshes, retain the previous snapshot until enrichment finishes.
        if previous == nil { try commit(snapshot, generation: id) }
        await update(content)
        let freshRoutes = try await routeResult
        let summaryData = try await summaryResult
        snapshot.routes = freshRoutes
        snapshot.summaries = summaryData.flatMap { try? RideOnAPI.decoder.decode(RideBoardLoader.SummariesResponse.self, from: $0).summaries } ?? []
        snapshot.enrichmentFailed = summaryData == nil || freshRoutes.values.contains { !$0.complete }
        snapshot.contextKey = try context(body: body, profile: profile, selection: selection.version, routes: freshRoutes, summaries: summaryData)
        try commit(snapshot, generation: id)
        return snapshot
    }

    /// Optional enrichment may fail independently, but authentication/cancellation always propagate.
    private func optional(_ path: String, body: Data? = nil) async throws -> Data? {
        do { return try await fetch(path, body, body == nil ? "GET" : "POST") }
        catch let error as RideOnAPI.Failure where error.status == 401 { throw error }
        catch { try Task.checkCancellation(); if error is CancellationError { throw error }; return nil }
    }

    private func context(body: Data, profile: Data, selection: Int?, routes: [String: CachedRideRoute], summaries: Data?) throws -> String? {
        guard let selection, routes.values.allSatisfy({ $0.version != nil && $0.complete }), let summaries,
              let summary = try? RideOnAPI.decoder.decode(RideBoardLoader.SummariesResponse.self, from: summaries),
              summary.historyRevision != nil else { return nil }
        let object: [String: Any] = ["request": try JSONSerialization.jsonObject(with: body),
                                   "profile": try JSONSerialization.jsonObject(with: profile),
                                   "selection": selection, "routes": routes.mapValues { $0.version! },
                                   "history": summary.historyRevision!]
        return RideBoardSnapshot.hash(try JSONSerialization.data(withJSONObject: object, options: .sortedKeys))
    }

    private func routes(_ ids: [String], previous: [String: CachedRideRoute]) async throws -> [String: CachedRideRoute] {
        try await withThrowingTaskGroup(of: (String, CachedRideRoute).self) { group in
            // Shortlists are bounded by the API. Each task only fetches geometry after checking its version.
            for id in ids {
                group.addTask {
                    let missing = CachedRideRoute(version: nil, info: .init(coordinates: [], cycleTravelURL: nil), complete: false)
                    guard let data = try await self.optional("/routes/\(id)"),
                          let route = try? RideOnAPI.decoder.decode(RideBoardLoader.RouteResponse.self, from: data).route else {
                        var fallback = previous[id] ?? missing
                        fallback.complete = false
                        return (id, fallback)
                    }
                    if let version = route.version, let cached = previous[id], cached.version == version, cached.complete { return (id, cached) }
                    let source = route.source
                    let url = source.flatMap { $0.providerId == "cycle-travel" ? URL(string: "https://cycle.travel/map/journey/\($0.externalId)") : nil }
                    guard let data = try await self.optional("/routes/\(id)/geometry"),
                          let geometry = try? RideOnAPI.decoder.decode(RideBoardLoader.GeometryResponse.self, from: data),
                          route.version == geometry.version else {
                        return (id, .init(version: route.version, info: .init(coordinates: [], cycleTravelURL: url), complete: false))
                    }
                    let coordinates = geometry.geometry.map { PolylineDecoder.decode($0.data, precision: 6) } ?? []
                    return (id, .init(version: route.version, info: .init(coordinates: coordinates, cycleTravelURL: url), complete: true))
                }
            }
            var result: [String: CachedRideRoute] = [:]
            for try await (id, route) in group { result[id] = route }
            return result
        }
    }
}

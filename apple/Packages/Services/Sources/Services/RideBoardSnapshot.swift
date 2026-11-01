import Networking
import Foundation
import CryptoKit
import Domain

/// Store the server response once, rather than repeating geometry in every pick/day/detail.
/// Mapping on the repository actor rebuilds localized presentation values off the UI thread.
struct RideBoardSnapshot: Codable, Sendable {
    static let schema = 1
    var schemaVersion = Self.schema
    var session: String
    var account: String
    var fetchedAt: Date
    var profile: Data
    var recommendation: Data?
    var routes: [String: CachedRideRoute]
    var summaries: [RideBoardLoader.Summary]
    var hours: RideWindow.Hours
    /// Nil while optional context is unavailable; such a snapshot can display but never skip refresh.
    var contextKey: String?
    var enrichmentFailed = false

    func response() throws -> RideBoardLoader.Recommendation? {
        try recommendation.map { try RideOnAPI.decoder.decode(RideBoardLoader.Recommendation.self, from: $0) }
    }

    func board() throws -> RideBoard? {
        guard let response = try response() else { return nil }
        let user = try RideOnAPI.decoder.decode(RideBoardLoader.UserResponse.self, from: profile)
        var board = RideBoardLoader.board(from: response, routes: routes.mapValues(\.info), summaries: summaries,
                                         units: .init(user.user.settings?.units, user.user.settings?.display))
        board.hours = hours
        return board
    }

    /// A forecast deadline never extends the validity of departures or a relative calendar choice.
    func refreshDate() -> Date {
        guard let response = try? response(), let refresh = response.weather?.refreshAt else { return fetchedAt }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: response.timeZone) ?? .current
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: fetchedAt)) ?? fetchedAt
        let departures = (response.rankings.compactMap(\.best) + response.days.compactMap(\.best)).map(\.departureAt)
        return ([refresh, midnight] + departures).min() ?? fetchedAt
    }

    func canReuse(at now: Date) -> Bool {
        contextKey != nil && now >= fetchedAt && now < refreshDate()
    }

    static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

struct CachedRideRoute: Codable, Sendable {
    var version: Int?
    var info: RideBoardLoader.RouteInfo
    /// A successful null geometry is complete too; don't retry it forever.
    var complete: Bool
}

struct RideBoardContent: Sendable {
    var board: RideBoard?
    var refreshAt: Date
    var fetchedAt: Date
    var account: String
    var contextVerified: Bool
    var enrichmentFailed: Bool

    init(_ snapshot: RideBoardSnapshot) throws {
        board = try snapshot.board()
        refreshAt = snapshot.refreshDate()
        fetchedAt = snapshot.fetchedAt
        account = snapshot.account
        contextVerified = snapshot.contextKey != nil
        enrichmentFailed = snapshot.enrichmentFailed
    }
}

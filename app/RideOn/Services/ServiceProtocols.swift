import Foundation
import RideOnCore

// Minimal protocol surface so every screen's data path is testable behind a
// fixture fake without network access or entitlements. Real signatures
// firm up in Phase 6 when the actual integrations land.

struct WeatherSnapshot: Sendable {
    var temperatureC: Double
    var sky: SkyCondition
    var windKph: Double
    var rainChance: Double
}

protocol WeatherProviding: Sendable {
    func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot
}

protocol ETAProviding: Sendable {
    func travelTime(from: Coordinate, to: Coordinate) async throws -> TimeInterval
}

protocol HealthStoreProviding: Sendable {
    func recentCyclingRides(since: Date) async throws -> [RideLog]
}

protocol StravaClientProtocol: Sendable {
    func exchangeToken(code: String) async throws -> String
    func importedRoutes() async throws -> [Route]
}

/// Result of a `/classify` call — the worker's response, translated into
/// `RideOnCore` types.
struct ClassifyResult: Sendable, Codable, Hashable {
    var surfaces: SurfaceBreakdown
    var suggestedType: SuggestedRouteType
    var lengthKm: Double
}

enum ClassifyClientError: Error, Sendable {
    case invalidResponse
    case requestFailed(status: Int)
}

protocol ClassifyClient: Sendable {
    func classify(coordinates: [Coordinate]) async throws -> ClassifyResult
}

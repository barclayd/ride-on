import Foundation
import Models
import DesignSystem

// Minimal protocol surface so every screen's data path is testable behind a
// fixture fake without network access or entitlements. Real signatures
// firm up in Phase 6 when the actual integrations land.

public struct WeatherSnapshot: Sendable {
    public var temperatureC: Double
    public var sky: SkyCondition
    public var windKph: Double
    public var rainChance: Double

    public init(temperatureC: Double, sky: SkyCondition, windKph: Double, rainChance: Double) {
        self.temperatureC = temperatureC
        self.sky = sky
        self.windKph = windKph
        self.rainChance = rainChance
    }
}

public protocol WeatherProviding: Sendable {
    func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot
}

public extension WeatherSnapshot {
    /// Expands a single day-level snapshot into an hourly run for
    /// `DailyContext.hourlyForecast`. `WeatherProviding` only returns one
    /// snapshot per day today (fixture-backed until Phase 6's real WeatherKit
    /// client returns actual hourly data), so every hour of the window gets
    /// the same reading — good enough for the engine's time-window scoring
    /// to have something real to slice.
    func hourlyForecast(from date: Date, hours: Int) -> [HourlyWeather] {
        (0..<max(hours, 1)).map { offset in
            HourlyWeather(
                time: date.addingTimeInterval(Double(offset) * 3600),
                temperatureC: temperatureC,
                windSpeedKph: windKph,
                windDirectionDegrees: 225,
                precipitationChance: rainChance,
                cloudCover: sky == .sunny ? 0.15 : sky == .rain ? 0.9 : 0.6
            )
        }
    }
}

public enum TravelMode: String, Sendable, CaseIterable, Codable {
    case automobile, cycling, transit
}

public protocol ETAProviding: Sendable {
    func travelTime(from: Coordinate, to: Coordinate, mode: TravelMode) async throws -> TimeInterval
}

public extension ETAProviding {
    /// Convenience default for call sites that don't care about transport
    /// mode (the pre-Phase-6 fixture usage). New callers should pass `mode`.
    func travelTime(from: Coordinate, to: Coordinate) async throws -> TimeInterval {
        try await travelTime(from: from, to: to, mode: .automobile)
    }
}

public protocol HealthStoreProviding: Sendable {
    func recentCyclingRides(since: Date, matchingAgainst routes: [Route]) async throws -> [RideLog]
}

public extension HealthStoreProviding {
    func recentCyclingRides(since: Date) async throws -> [RideLog] {
        try await recentCyclingRides(since: since, matchingAgainst: [])
    }
}

public struct StravaRoute: Sendable, Codable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var distanceKm: Double

    public init(id: String, name: String, distanceKm: Double) {
        self.id = id
        self.name = name
        self.distanceKm = distanceKm
    }
}

public struct StravaActivity: Sendable, Codable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var startDate: Date
    public var distanceKm: Double
    public var movingTimeSeconds: Double
    /// Decoded from Strava's `map.summary_polyline` — coarse but enough for
    /// `ActivityMatcher`'s overlap-based route matching (see
    /// `LiveStravaClient`'s ponytail note on why this skips a per-activity
    /// `/streams` call).
    public var coordinates: [Coordinate]

    public init(id: String, name: String, startDate: Date, distanceKm: Double, movingTimeSeconds: Double, coordinates: [Coordinate]) {
        self.id = id
        self.name = name
        self.startDate = startDate
        self.distanceKm = distanceKm
        self.movingTimeSeconds = movingTimeSeconds
        self.coordinates = coordinates
    }
}

public enum StravaClientError: Error, Sendable {
    case notConnected
    case requestFailed(status: Int)
    case invalidResponse
}

public protocol StravaClientProtocol: Sendable {
    func isConnected() async -> Bool
    func exchangeToken(code: String) async throws
    func disconnect() async
    func importedRoutes() async throws -> [Route]
    func listRoutes() async throws -> [StravaRoute]
    func exportRouteGPX(routeID: String) async throws -> Data
    func recentActivities(monthsAgo: Int) async throws -> [StravaActivity]
    func activityWebURL(activityID: String) -> URL
}

/// Result of a `/classify` call — the worker's response, translated into
/// `Models` types.
public struct ClassifyResult: Sendable, Codable, Hashable {
    public var surfaces: SurfaceBreakdown
    public var suggestedType: SuggestedRouteType
    public var lengthKm: Double

    public init(surfaces: SurfaceBreakdown, suggestedType: SuggestedRouteType, lengthKm: Double) {
        self.surfaces = surfaces
        self.suggestedType = suggestedType
        self.lengthKm = lengthKm
    }
}

public enum ClassifyClientError: Error, Sendable {
    case invalidResponse
    case requestFailed(status: Int)
}

public protocol ClassifyClient: Sendable {
    func classify(coordinates: [Coordinate]) async throws -> ClassifyResult
}

public enum ElevationClientError: Error, Sendable {
    case invalidResponse
    case requestFailed(status: Int)
}

public protocol ElevationClient: Sendable {
    /// Ground elevation in metres for each coordinate, in order; `nil` where
    /// the source has no data for that point.
    func elevations(coordinates: [Coordinate]) async throws -> [Double?]
}

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

public protocol ETAProviding: Sendable {
    func travelTime(from: Coordinate, to: Coordinate) async throws -> TimeInterval
}

public protocol HealthStoreProviding: Sendable {
    func recentCyclingRides(since: Date) async throws -> [RideLog]
}

public protocol StravaClientProtocol: Sendable {
    func exchangeToken(code: String) async throws -> String
    func importedRoutes() async throws -> [Route]
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

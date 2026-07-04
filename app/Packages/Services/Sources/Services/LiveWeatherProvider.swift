import Foundation
import WeatherKit
import CoreLocation
import Models
import DesignSystem

/// Real WeatherKit forecasts, day-level cached in memory (PLAN.md: "WeatherKit
/// service with day-level caching"). Only reachable at runtime once the
/// Release build has a real Apple Developer team + WeatherKit entitlement
/// (CLAUDE.md's signing note) — Debug/Simulator calls just throw, caught by
/// the call sites' `try?`.
public actor LiveWeatherProvider: WeatherProviding {
    private struct CacheKey: Hashable {
        var latQuantized: Int
        var lonQuantized: Int
        var day: Date
    }

    private var cache: [CacheKey: WeatherSnapshot] = [:]
    private let weatherService = WeatherService.shared

    public init() {}

    public func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot {
        let day = Calendar.current.startOfDay(for: date)
        let key = CacheKey(
            latQuantized: Int((location.latitude * 100).rounded()),
            lonQuantized: Int((location.longitude * 100).rounded()),
            day: day
        )
        if let cached = cache[key] { return cached }

        let clLocation = CLLocation(latitude: location.latitude, longitude: location.longitude)
        let hourly = try await weatherService.weather(for: clLocation, including: .hourly)
        guard let closest = hourly.min(by: { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }) else {
            throw WeatherProvidingError.noForecast
        }

        let snapshot = WeatherSnapshot(
            temperatureC: closest.temperature.converted(to: .celsius).value,
            sky: Self.sky(for: closest),
            windKph: closest.wind.speed.converted(to: .kilometersPerHour).value,
            rainChance: closest.precipitationChance
        )
        cache[key] = snapshot
        return snapshot
    }

    // ponytail: coarse condition -> SkyCondition mapping (rain-family vs.
    // cloud-cover threshold) rather than exhaustively switching every
    // `WeatherCondition` case — `AmbianceStyle` only needs sunny/overcast/
    // rain (never `.night`, resolved separately from time-of-day downstream).
    private static let rainConditions: Set<WeatherCondition> = [
        .drizzle, .rain, .heavyRain, .freezingRain, .freezingDrizzle, .sunShowers,
        .isolatedThunderstorms, .scatteredThunderstorms, .strongStorms, .thunderstorms,
        .hail, .sleet, .snow, .heavySnow, .flurries, .blizzard, .blowingSnow, .wintryMix,
    ]

    private static func sky(for hour: HourWeather) -> SkyCondition {
        if rainConditions.contains(hour.condition) { return .rain }
        return hour.cloudCover > 0.5 ? .overcast : .sunny
    }
}

public enum WeatherProvidingError: Error, Sendable {
    case noForecast
}

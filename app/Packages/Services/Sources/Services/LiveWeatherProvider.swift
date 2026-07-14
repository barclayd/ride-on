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
    }

    /// One 10-day hourly fetch per location per calendar day; every
    /// `forecast(for:on:)` call for any day inside the range is answered
    /// from it. Dates beyond the fetched hours throw `noForecast` — that's
    /// the "how far out do we trust the forecast" bound the best-day scan
    /// relies on.
    private var cache: [CacheKey: (fetchDay: Date, hours: [HourWeather])] = [:]
    private let weatherService = WeatherService.shared

    /// WeatherKit's hourly forecast extends ~10 days; past that there is no
    /// hour-level confidence to score against.
    public static let forecastDays = 10

    public init() {}

    public func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot {
        let key = CacheKey(
            latQuantized: Int((location.latitude * 100).rounded()),
            lonQuantized: Int((location.longitude * 100).rounded())
        )

        let today = Calendar.current.startOfDay(for: .now)
        let hours: [HourWeather]
        if let cached = cache[key], cached.fetchDay == today {
            hours = cached.hours
        } else {
            let clLocation = CLLocation(latitude: location.latitude, longitude: location.longitude)
            let end = Calendar.current.date(byAdding: .day, value: Self.forecastDays, to: today) ?? today
            let hourly = try await weatherService.weather(for: clLocation, including: .hourly(startDate: .now, endDate: end))
            hours = Array(hourly)
            cache[key] = (today, hours)
        }

        // No hour near the requested time means the date is outside the
        // forecast range — surface that rather than clamping to the last
        // known hour and pretending day 14 has a forecast.
        guard let closest = hours.min(by: { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }),
              abs(closest.date.timeIntervalSince(date)) <= 90 * 60 else {
            throw WeatherProvidingError.noForecast
        }

        return WeatherSnapshot(
            temperatureC: closest.temperature.converted(to: .celsius).value,
            sky: Self.sky(for: closest),
            windKph: closest.wind.speed.converted(to: .kilometersPerHour).value,
            rainChance: closest.precipitationChance
        )
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

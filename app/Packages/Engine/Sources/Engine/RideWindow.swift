import Foundation
import Models

/// The predicted wall-clock window a ride occupies, and the hourly forecast
/// slice that falls inside it. Shared by every weather factor so "score over
/// the actual riding window, not the whole day" (PLAN.md) is one calculation,
/// not four copies of it.
enum RideWindow {
    static func predicted(route: Route, context: DailyContext, preferences: RiderPreferences) -> ClosedRange<Date> {
        let durationSeconds = SpeedModel.estimateRideTime(
            distanceKm: route.distanceKm,
            elevationGainM: route.elevationGainM,
            surfaceShare: route.surfaces.shareBySurface,
            speedKphBySurface: preferences.speedKphBySurface,
            climbingPenaltyMinutesPer100m: preferences.climbingPenaltyMinutesPer100m
        )
        let start = context.date
        let end = start.addingTimeInterval(max(durationSeconds, 0))
        return start...end
    }

    /// Hours of `forecast` overlapping `window`; falls back to the single
    /// nearest sample when the forecast is sparser than the ride window
    /// (e.g. a 20-minute ride between two hourly samples).
    static func hourlySlice(forecast: [HourlyWeather], window: ClosedRange<Date>) -> [HourlyWeather] {
        let inWindow = forecast.filter { window.contains($0.time) }
        if !inWindow.isEmpty { return inWindow }
        guard let nearest = forecast.min(by: {
            abs($0.time.timeIntervalSince(window.lowerBound)) < abs($1.time.timeIntervalSince(window.lowerBound))
        }) else { return [] }
        return [nearest]
    }
}

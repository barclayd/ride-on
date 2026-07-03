import Foundation
import Models

/// Rain fit vs. `RiderPreferences.rainTolerance` (0 = no rain ever, 1 =
/// doesn't care), using the worst (highest) precipitation chance across the
/// predicted ride window — one soggy hour is enough to matter.
public struct RainFactor: FactorScoring {
    public var preferences: RiderPreferences

    public init(preferences: RiderPreferences) {
        self.preferences = preferences
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let window = RideWindow.predicted(route: route, context: context, preferences: preferences)
        let slice = RideWindow.hourlySlice(forecast: context.hourlyForecast, window: window)
        guard !slice.isEmpty else {
            return FactorScore(factor: .rain, value: 0.5, reason: "No rain forecast available.")
        }

        let maxChance = slice.map(\.precipitationChance).max() ?? 0
        let tolerance = min(max(preferences.rainTolerance, 0), 1)
        let value = 1 - maxChance * (1 - tolerance)

        let reason = "\(Int((maxChance * 100).rounded()))% chance of rain during the ride."
        return FactorScore(factor: .rain, value: value, reason: reason)
    }
}

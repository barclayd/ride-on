import Foundation
import Models

/// Temperature fit vs. `RiderPreferences.preferredTempRangeC`, averaged over
/// the predicted ride window.
public struct TemperatureFactor: FactorScoring {
    public var preferences: RiderPreferences

    public init(preferences: RiderPreferences) {
        self.preferences = preferences
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let window = RideWindow.predicted(route: route, context: context, preferences: preferences)
        let slice = RideWindow.hourlySlice(forecast: context.hourlyForecast, window: window)
        guard !slice.isEmpty else {
            return FactorScore(factor: .temperature, value: 0.5, reason: "No temperature forecast available.")
        }

        let avgTemp = slice.map(\.temperatureC).reduce(0, +) / Double(slice.count)
        let range = preferences.preferredTempRangeC

        let value: Double
        if range.contains(avgTemp) {
            value = 1.0
        } else {
            let distance = avgTemp < range.lowerBound ? range.lowerBound - avgTemp : avgTemp - range.upperBound
            // Falls off to 0 once 10C outside the comfortable range.
            value = max(0, 1 - distance / 10)
        }

        let reason = "About \(Int(avgTemp.rounded()))°C during the ride (you like \(Int(range.lowerBound))–\(Int(range.upperBound))°C)."
        return FactorScore(factor: .temperature, value: value, reason: reason)
    }
}

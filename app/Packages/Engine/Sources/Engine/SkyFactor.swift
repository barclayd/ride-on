import Foundation
import Models

/// Sky fit vs. `RiderPreferences.sunPreference`, averaged over the predicted
/// ride window. `.neutral` riders get a flat, mildly positive score — cloud
/// cover just isn't something they're optimizing for.
public struct SkyFactor: FactorScoring {
    public var preferences: RiderPreferences

    public init(preferences: RiderPreferences) {
        self.preferences = preferences
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let window = RideWindow.predicted(route: route, context: context, preferences: preferences)
        let slice = RideWindow.hourlySlice(forecast: context.hourlyForecast, window: window)
        guard !slice.isEmpty else {
            return FactorScore(factor: .sky, value: 0.5, reason: "No sky forecast available.")
        }

        let avgCloudCover = slice.map(\.cloudCover).reduce(0, +) / Double(slice.count)
        let skyDescription = "\(Int((1 - avgCloudCover) * 100))% clear sky"

        let value: Double
        let reason: String
        switch preferences.sunPreference {
        case .seek:
            value = 1 - avgCloudCover
            reason = "\(skyDescription) — you like the sun."
        case .avoid:
            value = avgCloudCover
            reason = "\(skyDescription) — you'd rather have cloud cover."
        case .neutral:
            value = 0.7
            reason = "\(skyDescription); sun doesn't sway you either way."
        }

        return FactorScore(factor: .sky, value: value, reason: reason)
    }
}

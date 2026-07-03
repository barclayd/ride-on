import Foundation
import Models

/// Wind alignment vs. route bearing segments (tailwind-home bias) combined
/// with wind-strength fit against the rider's `maxWindKph` tolerance — one
/// `RideFactor.wind` score covers both per PLAN.md's factor list.
public struct WindFactor: FactorScoring {
    public var preferences: RiderPreferences

    /// Below this, direction barely matters — score sits near `calmBaseline`
    /// regardless of alignment.
    private static let calmBaseline = 0.75

    public init(preferences: RiderPreferences) {
        self.preferences = preferences
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        guard !route.bearingSegments.isEmpty else {
            return FactorScore(factor: .wind, value: Self.calmBaseline, reason: "No route geometry to assess wind against.")
        }

        let window = RideWindow.predicted(route: route, context: context, preferences: preferences)
        let slice = RideWindow.hourlySlice(forecast: context.hourlyForecast, window: window)
        guard !slice.isEmpty else {
            return FactorScore(factor: .wind, value: Self.calmBaseline, reason: "No wind forecast available.")
        }

        let avgWindSpeed = slice.map(\.windSpeedKph).reduce(0, +) / Double(slice.count)
        let avgWindDirection = Self.circularMeanDegrees(slice.map(\.windDirectionDegrees))
        let alignmentScore = Self.alignmentScore(segments: route.bearingSegments, windFromDegrees: avgWindDirection)

        let strength = min(avgWindSpeed / max(preferences.maxWindKph, 1), 1.5)
        var value = Self.calmBaseline + strength * (alignmentScore - Self.calmBaseline)
        if avgWindSpeed > preferences.maxWindKph {
            value *= max(0.4, preferences.maxWindKph / avgWindSpeed)
        }

        let windDescription = "\(Int(avgWindSpeed.rounded()))kph wind"
        let reason: String
        if avgWindSpeed < 10 {
            reason = "Calm — \(windDescription), direction won't matter much."
        } else if alignmentScore >= 0.6 {
            reason = "\(windDescription), mostly a tailwind on the way home."
        } else if alignmentScore <= 0.4 {
            reason = "\(windDescription), headwind on the way home."
        } else {
            reason = "\(windDescription), mixed direction across the route."
        }

        return FactorScore(factor: .wind, value: value, reason: reason)
    }

    /// Weighted average headwind/tailwind alignment across segments, biased
    /// toward the back half of the ride (the "tailwind-home" preference) —
    /// 0 = full headwind home, 1 = full tailwind home.
    private static func alignmentScore(segments: [BearingSegment], windFromDegrees: Double) -> Double {
        let totalLength = segments.reduce(0) { $0 + $1.lengthKm }
        guard totalLength > 0 else { return 0.5 }

        let windTowardsDegrees = (windFromDegrees + 180).truncatingRemainder(dividingBy: 360)

        var cumulative = 0.0
        var weightedAlignment = 0.0
        var weightSum = 0.0
        for segment in segments {
            let midpointFraction = (cumulative + segment.lengthKm / 2) / totalLength
            cumulative += segment.lengthKm

            // 1.0x weight at the start of the ride, 1.5x by the finish.
            let homeBias = 0.5 + midpointFraction
            let diff = angularDifferenceDegrees(segment.bearingDegrees, windTowardsDegrees)
            let alignment = cos(diff * .pi / 180) // 1 = tailwind, -1 = headwind

            weightedAlignment += alignment * segment.lengthKm * homeBias
            weightSum += segment.lengthKm * homeBias
        }

        guard weightSum > 0 else { return 0.5 }
        return (weightedAlignment / weightSum + 1) / 2
    }

    private static func angularDifferenceDegrees(_ a: Double, _ b: Double) -> Double {
        let diff = abs(a - b).truncatingRemainder(dividingBy: 360)
        return diff > 180 ? 360 - diff : diff
    }

    private static func circularMeanDegrees(_ degrees: [Double]) -> Double {
        guard !degrees.isEmpty else { return 0 }
        let sinSum = degrees.reduce(0) { $0 + sin($1 * .pi / 180) }
        let cosSum = degrees.reduce(0) { $0 + cos($1 * .pi / 180) }
        let mean = atan2(sinSum, cosSum) * 180 / .pi
        return (mean + 360).truncatingRemainder(dividingBy: 360)
    }
}

import Foundation
import Models

/// Estimates ride duration from distance, elevation, and per-surface
/// cruising speed. Used by `TimeBudgetFactor` and, later, route stats.
public enum SpeedModel {
    /// - Parameters:
    ///   - distanceKm: total ride distance.
    ///   - elevationGainM: total climbing, in meters.
    ///   - surfaceShare: fraction of `distanceKm` ridden on each surface (should sum to ~1.0).
    ///   - speedKphBySurface: cruising speed for each surface, from `RiderPreferences`.
    ///   - climbingPenaltyMinutesPer100m: extra minutes added per 100m of gain.
    public static func estimateRideTime(
        distanceKm: Double,
        elevationGainM: Double,
        surfaceShare: [SurfaceType: Double],
        speedKphBySurface: [SurfaceType: Double],
        climbingPenaltyMinutesPer100m: Double
    ) -> TimeInterval {
        guard distanceKm > 0 else { return 0 }

        let flatHours: Double = surfaceShare.reduce(0) { total, entry in
            let (surface, share) = entry
            let speed = speedKphBySurface[surface] ?? averageSpeed(speedKphBySurface)
            guard speed > 0 else { return total }
            return total + (distanceKm * share) / speed
        }

        let climbingMinutes = (elevationGainM / 100) * climbingPenaltyMinutesPer100m
        return flatHours * 3600 + climbingMinutes * 60
    }

    private static func averageSpeed(_ speeds: [SurfaceType: Double]) -> Double {
        guard !speeds.isEmpty else { return 20 }
        return speeds.values.reduce(0, +) / Double(speeds.count)
    }
}

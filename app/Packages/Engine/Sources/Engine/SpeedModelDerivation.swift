import Foundation
import Models

/// Derives `RiderPreferences.speedKphBySurface` from matched-activity
/// observations (PLAN.md Phase 6: "activity fetch -> per-surface speed
/// distribution"). Each observation is one ride's average speed plus the
/// matched route's surface mix; a surface's derived speed is the mix-weighted
/// average of every observed ride's average speed, weighted by that ride's
/// share of that surface (so a mostly-unpaved ride mostly informs the
/// unpaved speed, not the paved one).
///
/// ponytail: attributes a *whole ride's* average speed to each surface it
/// touched, weighted by that surface's share of the ride — not true
/// per-surface pace (which would need GPS-timestamped, surface-tagged
/// segments our route geometry doesn't carry yet). Good enough to beat the
/// static defaults; upgrade to segment-level pace if `RouteModel` ever
/// stores per-coordinate surface tags.
public enum SpeedModelDerivation {
    public static func deriveSpeeds(
        observations: [(surfaceShare: [SurfaceType: Double], avgSpeedKph: Double)],
        defaults: [SurfaceType: Double]
    ) -> [SurfaceType: Double] {
        var weightedSum: [SurfaceType: Double] = [:]
        var weightTotal: [SurfaceType: Double] = [:]

        for observation in observations {
            for (surface, share) in observation.surfaceShare where share > 0 {
                weightedSum[surface, default: 0] += share * observation.avgSpeedKph
                weightTotal[surface, default: 0] += share
            }
        }

        var result = defaults
        for (surface, total) in weightTotal where total > 0 {
            result[surface] = weightedSum[surface, default: 0] / total
        }
        return result
    }
}

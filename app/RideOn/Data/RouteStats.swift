import Foundation
import RideOnCore

/// Estimated ride time for a persisted route, via the existing `SpeedModel`.
enum RouteStats {
    static func estimatedRideTime(
        for route: RouteModel,
        preferences: RiderPreferences = RiderPreferences()
    ) -> TimeInterval {
        let bySurface = route.surfaces?.distanceKmBySurface ?? [:]
        let totalKm = bySurface.values.reduce(0, +)
        // ponytail: an unclassified route (no surfaces yet) is treated as
        // all-paved for a rough ETA rather than blocking on classification.
        let surfaceShare: [SurfaceType: Double] = totalKm > 0
            ? bySurface.mapValues { $0 / totalKm }
            : [.paved: 1.0]

        return SpeedModel.estimateRideTime(
            distanceKm: route.distanceKm,
            elevationGainM: route.elevationGainM,
            surfaceShare: surfaceShare,
            speedKphBySurface: preferences.speedKphBySurface,
            climbingPenaltyMinutesPer100m: preferences.climbingPenaltyMinutesPer100m
        )
    }
}

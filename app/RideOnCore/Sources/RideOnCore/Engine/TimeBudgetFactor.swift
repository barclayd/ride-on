import Foundation

/// Scores how well a route's estimated ride time fits the hours the rider
/// has available today. Real logic (the Phase 0 proof-of-concept factor);
/// travel-time-to-start and `backBy` refinement land in Phase 3.
public struct TimeBudgetFactor: FactorScoring {
    public var preferences: RiderPreferences

    public init(preferences: RiderPreferences) {
        self.preferences = preferences
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let estimatedSeconds = SpeedModel.estimateRideTime(
            distanceKm: route.distanceKm,
            elevationGainM: route.elevationGainM,
            surfaceShare: route.surfaces.totalKm > 0
                ? route.surfaces.distanceKmBySurface.mapValues { $0 / route.surfaces.totalKm }
                : [:],
            speedKphBySurface: preferences.speedKphBySurface,
            climbingPenaltyMinutesPer100m: preferences.climbingPenaltyMinutesPer100m
        )
        let estimatedHours = estimatedSeconds / 3600
        let hoursAvailable = context.hoursAvailable

        guard hoursAvailable > 0 else {
            return FactorScore(factor: .timeBudget, value: 0, reason: "No time available today.")
        }

        let value: Double
        if estimatedHours <= hoursAvailable {
            // Fits comfortably; reward routes that use more of the available window.
            value = 0.7 + 0.3 * (estimatedHours / hoursAvailable)
        } else {
            // Linear falloff to 0 once the ride takes twice the available time.
            let overBy = (estimatedHours - hoursAvailable) / hoursAvailable
            value = 1 - overBy
        }

        let reason = "About \(formatted(estimatedHours))h ride vs \(formatted(hoursAvailable))h available."
        return FactorScore(factor: .timeBudget, value: value, reason: reason)
    }

    private func formatted(_ hours: Double) -> String {
        String(format: "%.1f", hours)
    }
}

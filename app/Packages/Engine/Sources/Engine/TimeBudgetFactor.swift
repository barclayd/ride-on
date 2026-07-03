import Foundation
import Models

/// Scores how well a route's estimated ride time — plus the travel to and
/// from its start — fits the hours the rider has available today, and any
/// hard `backBy` deadline. Assumes a fixed driving speed to the route start
/// since real ETAs (MapKit) aren't available to this platform-free package;
/// good enough to make "far routes get penalized when time is tight" real.
public struct TimeBudgetFactor: FactorScoring {
    public var preferences: RiderPreferences

    /// ponytail: a flat assumed speed stands in for a real MapKit ETA
    /// (Phase 6); revisit if straight-line distance proves a bad proxy for
    /// actual travel time in the areas Dan rides.
    private static let assumedTravelSpeedKph = 40.0

    public init(preferences: RiderPreferences) {
        self.preferences = preferences
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let estimatedRideHours = SpeedModel.estimateRideTime(
            distanceKm: route.distanceKm,
            elevationGainM: route.elevationGainM,
            surfaceShare: route.surfaces.shareBySurface,
            speedKphBySurface: preferences.speedKphBySurface,
            climbingPenaltyMinutesPer100m: preferences.climbingPenaltyMinutesPer100m
        ) / 3600

        let travelKmOneWay = route.start.map { GPXGeometry.haversineKm(context.startLocation, $0) } ?? 0
        let travelHoursOneWay = travelKmOneWay / Self.assumedTravelSpeedKph
        let totalHours = estimatedRideHours + travelHoursOneWay * 2

        var hoursAvailable = context.hoursAvailable
        var boundByBackBy = false
        if let backBy = context.backBy {
            let hoursUntilBackBy = max(0, backBy.timeIntervalSince(context.date) / 3600)
            if hoursUntilBackBy < hoursAvailable {
                hoursAvailable = hoursUntilBackBy
                boundByBackBy = true
            }
        }

        guard hoursAvailable > 0 else {
            return FactorScore(factor: .timeBudget, value: 0, reason: "No time available today.")
        }

        let value: Double
        if totalHours <= hoursAvailable {
            // Fits comfortably; reward routes that use more of the available window.
            value = 0.7 + 0.3 * (totalHours / hoursAvailable)
        } else {
            // Linear falloff to 0 once the trip takes twice the available time.
            let overBy = (totalHours - hoursAvailable) / hoursAvailable
            value = 1 - overBy
        }

        var reason = "About \(formatted(estimatedRideHours))h ride"
        if travelHoursOneWay > 0 {
            reason += " + \(formatted(travelHoursOneWay * 2))h travel"
        }
        reason += " vs \(formatted(hoursAvailable))h available"
        reason += boundByBackBy ? " (back-by deadline)." : "."

        return FactorScore(factor: .timeBudget, value: value, reason: reason)
    }

    private func formatted(_ hours: Double) -> String {
        String(format: "%.1f", hours)
    }
}

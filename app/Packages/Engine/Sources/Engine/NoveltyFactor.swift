import Foundation
import Models

/// Novelty: ride-log recency decay + geometric overlap between routes,
/// weighted by `RiderPreferences.noveltyDial` (0 = always ride favourites,
/// 1 = always seek something new; 0.5 = doesn't care, so the raw signal is
/// squashed to a flat-ish 0.5).
///
/// Riding a route (or a route that shares roads with one you rode recently)
/// makes it "stale"; staleness decays with an exponential half-life so
/// yesterday's ride matters a lot and a month-old one barely at all.
public struct NoveltyFactor: FactorScoring {
    public var preferences: RiderPreferences
    public var rideLogs: [RideLog]
    /// Every known route, used to look up geometry for `rideLogs` entries
    /// that aren't the route being scored (the overlap check).
    public var allRoutes: [Route]

    private static let halfLifeDays = 14.0

    public init(preferences: RiderPreferences, rideLogs: [RideLog], allRoutes: [Route]) {
        self.preferences = preferences
        self.rideLogs = rideLogs
        self.allRoutes = allRoutes
    }

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let routesByID = Dictionary(uniqueKeysWithValues: allRoutes.map { ($0.id, $0) })

        var maxStaleness = 0.0
        var stalestIsSameRoute = false
        for log in rideLogs {
            let overlap: Double
            if log.routeID == route.id {
                overlap = 1.0
            } else if let loggedRoute = routesByID[log.routeID] {
                overlap = GPXGeometry.overlapFraction(route.coordinates, loggedRoute.coordinates)
            } else {
                continue
            }
            guard overlap > 0 else { continue }

            let daysSince = max(0, context.date.timeIntervalSince(log.date) / 86400)
            let recencyStaleness = exp(-daysSince / Self.halfLifeDays)
            let contribution = overlap * recencyStaleness
            if contribution > maxStaleness {
                maxStaleness = contribution
                stalestIsSameRoute = log.routeID == route.id
            }
        }

        let rawNovelty = min(1, max(0, 1 - maxStaleness))
        let dial = min(max(preferences.noveltyDial, 0), 1)
        // dial=1 -> value tracks novelty directly; dial=0 -> value rewards
        // staleness (favourites) instead; dial=0.5 -> flattens to ~neutral.
        let value = 0.5 + (2 * dial - 1) * (rawNovelty - 0.5)

        let reason: String
        if maxStaleness < 0.05 {
            reason = "Fresh — haven't ridden this or anything like it recently."
        } else if stalestIsSameRoute {
            reason = "You've ridden this route recently."
        } else {
            reason = "Overlaps a route you've ridden recently."
        }

        return FactorScore(factor: .novelty, value: value, reason: reason)
    }
}

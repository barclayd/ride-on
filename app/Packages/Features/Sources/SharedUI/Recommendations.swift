import Foundation
import Models
import Engine
import Services

/// Wires the real `Engine` factors into one `WeightedScorer` and builds the
/// `DailyContext` "today" from the rider's context-pill choices + a weather
/// snapshot. One shared path so Today's ranking and Route Detail's
/// `BestDayBadge` 7-day scan never drift from each other.
public enum Recommendations {
    public static func scorer(
        preferences: RiderPreferences,
        rideLogs: [RideLog],
        allRoutes: [Route],
        weights: [RideFactor: Double]
    ) -> WeightedScorer {
        WeightedScorer(
            factors: [
                TimeBudgetFactor(preferences: preferences),
                WindFactor(preferences: preferences),
                TemperatureFactor(preferences: preferences),
                SkyFactor(preferences: preferences),
                RainFactor(preferences: preferences),
                SurfaceMatchFactor(),
                IntentFactor(),
                NoveltyFactor(preferences: preferences, rideLogs: rideLogs, allRoutes: allRoutes),
            ],
            weights: weights
        )
    }

    public static func context(
        date: Date,
        startLocation: Coordinate,
        hoursAvailable: Double,
        backBy: Date?,
        intent: RideIntent,
        bike: Bike,
        weather: WeatherSnapshot
    ) -> DailyContext {
        DailyContext(
            date: date,
            startLocation: startLocation,
            hoursAvailable: hoursAvailable,
            backBy: backBy,
            intent: intent,
            bike: bike,
            hourlyForecast: weather.hourlyForecast(from: date, hours: max(Int(hoursAvailable.rounded(.up)) + 2, 4))
        )
    }

    /// The best-scoring day across `weekContexts`, if any clears
    /// `BestDayScan.threshold` — the raw material for `BestDayBadge`, which
    /// per DESIGN-SYSTEM.md §6 is simply absent otherwise (never an empty
    /// state).
    public static func bestDay(for route: Route, weekContexts: [DailyContext], scorer: WeightedScorer) -> (context: DailyContext, score: Double)? {
        let scored = weekContexts.map { context in
            (context: context, score: scorer.rank(routes: [route], context: context).first?.score ?? 0)
        }
        guard let best = scored.max(by: { $0.score < $1.score }), best.score >= BestDayScan.threshold else {
            return nil
        }
        return best
    }
}

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

    /// One `DailyContext` per upcoming day that still has a forecast —
    /// each day fetched individually so the scan compares real per-day
    /// conditions. Days the provider can't forecast (beyond WeatherKit's
    /// ~10-day hourly range) are skipped: that's the confidence bound on
    /// "best day in the next 10".
    public static func upcomingContexts(
        days: Int = 10,
        weather: WeatherProviding,
        weatherLocation: Coordinate? = nil,
        startLocation: Coordinate,
        hoursAvailable: Double,
        backBy: Date? = nil,
        intent: RideIntent,
        bike: Bike
    ) async -> [DailyContext] {
        var contexts: [DailyContext] = []
        for offset in 0..<days {
            guard let date = Calendar.current.date(byAdding: .day, value: offset, to: .now),
                  let snapshot = try? await weather.forecast(for: weatherLocation ?? startLocation, on: date) else { continue }
            contexts.append(context(
                date: date,
                startLocation: startLocation,
                hoursAvailable: hoursAvailable,
                // A back-by deadline is a today constraint, not a standing one.
                backBy: offset == 0 ? backBy : nil,
                intent: intent,
                bike: bike,
                weather: snapshot
            ))
        }
        return contexts
    }

    /// The best day to ride `route` across `contexts`, graded as a
    /// `RideTier`. A `.d` tier means "don't ride" — the UI says so instead
    /// of hiding the recommendation.
    public static func bestDay(for route: Route, contexts: [DailyContext], scorer: WeightedScorer) -> DayRecommendation? {
        BestDayScan.recommend(for: route, contexts: contexts, scorer: scorer)
    }
}

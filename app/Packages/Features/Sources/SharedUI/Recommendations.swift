import Foundation
import Models
import Engine
import Services

/// Wires the real `Engine` factors into one `WeightedScorer` and builds the
/// per-day contexts the Ride tab and `BestDayBadge` score against. One
/// shared path so the day ranking and the 10-day best-day scan never drift
/// from each other — both pick each day's ride start with `BestWindowScan`.
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

    /// A back-by deadline is a time of day, not an instant — the editor's
    /// picker produces a today-anchored `Date`, and scoring any other day
    /// reprojects its hour/minute onto that day.
    public static func backBy(_ time: Date?, projectedOnto day: Date) -> Date? {
        guard let time else { return nil }
        let components = Calendar.current.dateComponents([.hour, .minute], from: time)
        return Calendar.current.date(bySettingHour: components.hour ?? 0, minute: components.minute ?? 0, second: 0, of: day)
    }

    /// The shared best window on `day` and the full ranking scored inside
    /// it. Each route keeps its own forecast (`hoursByRouteID`) and start
    /// location; the window itself is one per day — the candidate start
    /// whose top route scores highest.
    public static func windowRanking(
        day: Date,
        routes: [Route],
        hoursByRouteID: [UUID: [HourlyWeather]],
        ridingWindowMinutes: ClosedRange<Int>,
        hoursAvailable: Double,
        backBy: Date?,
        intent: RideIntent,
        bike: Bike,
        startLocationFor: (Route) -> Coordinate,
        scorer: WeightedScorer,
        /// A user-chosen ride start (the hero card's window pill): skip the
        /// scan and rank every route at exactly this instant.
        pinnedStart: Date? = nil,
        now: Date = .now
    ) -> BestWindowScan.WindowRanking? {
        let projectedBackBy = Self.backBy(backBy, projectedOnto: day)
        var starts: [Date]
        if let pinnedStart {
            starts = [pinnedStart]
        } else {
            starts = BestWindowScan.candidateStarts(
                on: day,
                ridingWindowMinutes: ridingWindowMinutes,
                hoursAvailable: hoursAvailable,
                backBy: projectedBackBy,
                earliest: Calendar.current.isDate(day, inSameDayAs: now) ? now : nil
            )
            if starts.isEmpty {
                // Today after the riding window has closed: "score a ride
                // starting now" beats an empty screen.
                starts = [now]
            }
        }
        return BestWindowScan.best(starts: starts, scorer: scorer) { start in
            routes.compactMap { route in
                guard let hours = hoursByRouteID[route.id] else { return nil }
                return (route, DailyContext(
                    date: start,
                    startLocation: startLocationFor(route),
                    hoursAvailable: hoursAvailable,
                    backBy: projectedBackBy,
                    intent: intent,
                    bike: bike,
                    hourlyForecast: hours
                ))
            }
        }
    }

    /// One `DailyContext` per upcoming day that still has a forecast, each
    /// anchored at that day's best window for `route`. Days the provider
    /// can't forecast (beyond WeatherKit's ~10-day hourly range) are
    /// skipped: that's the confidence bound on "best day in the next 10".
    public static func upcomingWindowContexts(
        days: Int = 10,
        route: Route,
        weather: WeatherProviding,
        weatherLocation: Coordinate,
        startLocation: Coordinate,
        ridingWindowMinutes: ClosedRange<Int>,
        hoursAvailable: Double,
        backBy: Date? = nil,
        intent: RideIntent,
        bike: Bike,
        scorer: WeightedScorer
    ) async -> [DailyContext] {
        var contexts: [DailyContext] = []
        for offset in 0..<days {
            guard let day = Calendar.current.date(byAdding: .day, value: offset, to: .now),
                  let hours = try? await weather.hourlyForecast(for: weatherLocation, on: day),
                  let ranking = windowRanking(
                      day: day,
                      routes: [route],
                      hoursByRouteID: [route.id: hours],
                      ridingWindowMinutes: ridingWindowMinutes,
                      hoursAvailable: hoursAvailable,
                      backBy: backBy,
                      intent: intent,
                      bike: bike,
                      startLocationFor: { _ in startLocation },
                      scorer: scorer
                  ) else { continue }
            contexts.append(DailyContext(
                date: ranking.start,
                startLocation: startLocation,
                hoursAvailable: hoursAvailable,
                backBy: Self.backBy(backBy, projectedOnto: day),
                intent: intent,
                bike: bike,
                hourlyForecast: hours
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

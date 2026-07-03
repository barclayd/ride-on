import Foundation
import Models

/// "Best day this week" — threshold-based; the route detail's `BestDayBadge`
/// (Phase 4) is simply absent below `threshold`. Pure and deterministic:
/// pass in one `DailyContext` per candidate day (each carrying that day's
/// forecast), get back whether `date` is the best of the bunch.
public enum BestDayScan {
    public static let threshold = 0.75

    /// - Parameters:
    ///   - route: the route being evaluated.
    ///   - date: the day to check — must match the `date` of one of `weekContexts`.
    ///   - weekContexts: one `DailyContext` per day under consideration (e.g. the next 7 days).
    ///   - scorer: scores `route` for each day's context.
    public static func isBestDay(
        for route: Route,
        date: Date,
        weekContexts: [DailyContext],
        scorer: WeightedScorer
    ) -> Bool {
        let calendar = Calendar.current
        let scoresByDay = weekContexts.map { context in
            (context.date, scorer.rank(routes: [route], context: context).first?.score ?? 0)
        }
        guard let todayScore = scoresByDay.first(where: { calendar.isDate($0.0, inSameDayAs: date) })?.1 else {
            return false
        }
        guard todayScore >= threshold else { return false }
        return scoresByDay.allSatisfy { $0.1 <= todayScore }
    }
}

import Foundation
import Models

/// The scan's verdict for one route: the best-scoring day among the
/// candidate contexts, graded as a `RideTier`. When even the best day is
/// `.d`, the recommendation is "don't ride" — the UI says so instead of
/// hiding the badge.
public struct DayRecommendation: Sendable {
    public var context: DailyContext
    public var score: Double
    public var factorScores: [FactorScore]

    public var tier: RideTier { RideTier(score: score) }

    public init(context: DailyContext, score: Double, factorScores: [FactorScore]) {
        self.context = context
        self.score = score
        self.factorScores = factorScores
    }
}

/// "Which of the next N days should I ride this?" Pure and deterministic:
/// pass in one `DailyContext` per candidate day (each carrying that day's
/// own forecast — typically up to 10 days, bounded by how far out the
/// weather provider has data), get back the best of the bunch.
public enum BestDayScan {
    /// - Parameters:
    ///   - route: the route being evaluated.
    ///   - contexts: one `DailyContext` per day under consideration.
    ///   - scorer: scores `route` for each day's context.
    /// - Returns: the best-scoring day, or `nil` if `contexts` is empty.
    ///   Earlier days win ties — no reason to wait for the same conditions.
    public static func recommend(
        for route: Route,
        contexts: [DailyContext],
        scorer: WeightedScorer
    ) -> DayRecommendation? {
        contexts
            .compactMap { context -> DayRecommendation? in
                guard let ranked = scorer.rank(routes: [route], context: context).first else { return nil }
                return DayRecommendation(context: context, score: ranked.score, factorScores: ranked.factorScores)
            }
            .sorted { lhs, rhs in
                if lhs.score != rhs.score { return lhs.score > rhs.score }
                return lhs.context.date < rhs.context.date
            }
            .first
    }
}

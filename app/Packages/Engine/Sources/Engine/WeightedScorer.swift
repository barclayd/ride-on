import Foundation
import Models

/// A route ranked for a given day, with the per-factor breakdown that
/// justifies its position (shown in the breakdown sheet).
public struct RankedRide: Sendable {
    public var route: Route
    public var score: Double
    public var factorScores: [FactorScore]

    public init(route: Route, score: Double, factorScores: [FactorScore]) {
        self.route = route
        self.score = score
        self.factorScores = factorScores
    }
}

/// Combines factor scores into a single ranking, weighted by the
/// user-adjustable weights panel. Pure and deterministic: same inputs,
/// same order, every time.
public struct WeightedScorer: Sendable {
    public var factors: [any FactorScoring]
    public var weights: [RideFactor: Double]

    public init(factors: [any FactorScoring], weights: [RideFactor: Double]) {
        self.factors = factors
        self.weights = weights
    }

    public func rank(routes: [Route], context: DailyContext) -> [RankedRide] {
        let ranked = routes.map { route -> RankedRide in
            let scores = factors.map { $0.score(route: route, context: context) }
            let totalWeight = scores.reduce(0) { $0 + (weights[$1.factor] ?? 1) }
            let weightedSum = scores.reduce(0) { $0 + $1.value * (weights[$1.factor] ?? 1) }
            let score = totalWeight > 0 ? weightedSum / totalWeight : 0
            return RankedRide(route: route, score: score, factorScores: scores)
        }

        // Stable, deterministic ordering: score desc, then route id as a tiebreaker.
        return ranked.sorted { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            return lhs.route.id.uuidString < rhs.route.id.uuidString
        }
    }
}

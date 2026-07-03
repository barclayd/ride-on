import Foundation
import Testing
import Models
@testable import Engine

@Suite("WeightedScorer")
struct WeightedScorerTests {
    /// A fake factor whose value depends only on the route name, so tests
    /// can control ordering precisely without real weather/time inputs.
    private struct FixedFactor: FactorScoring {
        let factor: RideFactor
        let valuesByRouteName: [String: Double]

        func score(route: Route, context: DailyContext) -> FactorScore {
            FactorScore(factor: factor, value: valuesByRouteName[route.name] ?? 0.5, reason: "fixed")
        }
    }

    private func route(_ name: String) -> Route {
        Route(
            name: name,
            distanceKm: 30,
            elevationGainM: 0,
            surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 30]),
            suggestedBikeType: .road
        )
    }

    private var context: DailyContext {
        DailyContext(
            date: .now,
            startLocation: Coordinate(latitude: 0, longitude: 0),
            hoursAvailable: 3,
            intent: .easy,
            bike: Bike(name: "Bike", type: .road)
        )
    }

    @Test("ranking is deterministic across repeated runs")
    func deterministicOrdering() {
        let scorer = WeightedScorer(
            factors: [FixedFactor(factor: .wind, valuesByRouteName: ["A": 0.9, "B": 0.4, "C": 0.6])],
            weights: [.wind: 1.0]
        )
        let routes = [route("A"), route("B"), route("C")]

        let first = scorer.rank(routes: routes, context: context).map(\.route.name)
        let second = scorer.rank(routes: routes, context: context).map(\.route.name)

        #expect(first == second)
        #expect(first == ["A", "C", "B"])
    }

    @Test("changing weights reorders the ranking")
    func weightChangeReordersRanking() {
        // Route A wins on wind, Route B wins on novelty.
        let factors: [any FactorScoring] = [
            FixedFactor(factor: .wind, valuesByRouteName: ["A": 1.0, "B": 0.0]),
            FixedFactor(factor: .novelty, valuesByRouteName: ["A": 0.0, "B": 1.0])
        ]
        let routes = [route("A"), route("B")]

        let windHeavy = WeightedScorer(factors: factors, weights: [.wind: 10, .novelty: 1])
        #expect(windHeavy.rank(routes: routes, context: context).first?.route.name == "A")

        let noveltyHeavy = WeightedScorer(factors: factors, weights: [.wind: 1, .novelty: 10])
        #expect(noveltyHeavy.rank(routes: routes, context: context).first?.route.name == "B")
    }

    @Test("ties break deterministically by route id")
    func tiesBreakByRouteID() {
        let scorer = WeightedScorer(
            factors: [FixedFactor(factor: .wind, valuesByRouteName: [:])],
            weights: [.wind: 1.0]
        )
        let routes = [route("A"), route("B")]
        let ranked = scorer.rank(routes: routes, context: context)
        let expectedFirst = min(routes[0].id.uuidString, routes[1].id.uuidString)
        #expect(ranked.first?.route.id.uuidString == expectedFirst)
    }
}

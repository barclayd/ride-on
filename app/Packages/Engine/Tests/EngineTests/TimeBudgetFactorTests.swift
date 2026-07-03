import Foundation
import Testing
import Models
@testable import Engine

@Suite("TimeBudgetFactor")
struct TimeBudgetFactorTests {
    private func route(distanceKm: Double, elevationGainM: Double = 0) -> Route {
        Route(
            name: "Test Route",
            distanceKm: distanceKm,
            elevationGainM: elevationGainM,
            surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: distanceKm]),
            suggestedBikeType: .road
        )
    }

    private func context(hoursAvailable: Double) -> DailyContext {
        DailyContext(
            date: .now,
            startLocation: Coordinate(latitude: 51.5, longitude: -1.2),
            hoursAvailable: hoursAvailable,
            intent: .training,
            bike: Bike(name: "Road Bike", type: .road)
        )
    }

    private var preferences: RiderPreferences {
        RiderPreferences(speedKphBySurface: [.paved: 20], climbingPenaltyMinutesPer100m: 0)
    }

    @Test("a route that fits comfortably scores in the high band")
    func fitsComfortably() {
        let factor = TimeBudgetFactor(preferences: preferences)
        // 40km @ 20kph = 2h estimated, 4h available.
        let score = factor.score(route: route(distanceKm: 40), context: context(hoursAvailable: 4))
        #expect(score.factor == .timeBudget)
        #expect(score.value >= 0.7 && score.value <= 1.0)
    }

    @Test("a route that exactly fills the available time scores at the top of the band")
    func fillsAvailableTime() {
        let factor = TimeBudgetFactor(preferences: preferences)
        // 40km @ 20kph = 2h estimated, 2h available -> ratio 1.0 -> value 1.0.
        let score = factor.score(route: route(distanceKm: 40), context: context(hoursAvailable: 2))
        #expect(score.value == 1.0)
    }

    @Test("a route that overruns the available time scores below the fits-band floor")
    func overrunsAvailableTime() {
        let factor = TimeBudgetFactor(preferences: preferences)
        // 40km @ 20kph = 2h estimated, 1h available -> overshoots by 100%.
        let score = factor.score(route: route(distanceKm: 40), context: context(hoursAvailable: 1))
        #expect(score.value < 0.7)
    }

    @Test("a route double the available time scores zero")
    func wayOverBudgetScoresZero() {
        let factor = TimeBudgetFactor(preferences: preferences)
        // 40km @ 20kph = 2h estimated, 1h available is exactly the 2x cutoff.
        let score = factor.score(route: route(distanceKm: 40), context: context(hoursAvailable: 1))
        #expect(score.value == 0)
    }

    @Test("no time available today scores zero regardless of route")
    func noTimeAvailable() {
        let factor = TimeBudgetFactor(preferences: preferences)
        let score = factor.score(route: route(distanceKm: 40), context: context(hoursAvailable: 0))
        #expect(score.value == 0)
    }
}

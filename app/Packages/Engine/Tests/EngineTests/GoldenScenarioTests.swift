import Foundation
import Testing
import Models
@testable import Engine

/// Phase 3 golden scenarios: end-to-end proof that the real factors move the
/// ranking the way PLAN.md describes, not just that each factor's math is
/// internally consistent.
@Suite("Golden scenarios")
struct GoldenScenarioTests {
    private let fixedDate = Date(timeIntervalSince1970: 1_750_000_000) // a fixed summer morning
    private let start = Coordinate(latitude: 51.0, longitude: -1.0)

    private func preferences(maxWindKph: Double = 20) -> RiderPreferences {
        RiderPreferences(
            maxWindKph: maxWindKph,
            speedKphBySurface: [.paved: 20, .unpaved: 20],
            climbingPenaltyMinutesPer100m: 0
        )
    }

    private func route(
        _ name: String,
        distanceKm: Double = 10,
        elevationGainM: Double = 0,
        start: Coordinate? = nil,
        bearingSegments: [BearingSegment] = [],
        coordinates: [Coordinate] = []
    ) -> Route {
        Route(
            name: name,
            distanceKm: distanceKm,
            elevationGainM: elevationGainM,
            surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: distanceKm]),
            suggestedBikeType: .road,
            start: start,
            coordinates: coordinates,
            bearingSegments: bearingSegments
        )
    }

    private func fullScorer(preferences: RiderPreferences, rideLogs: [RideLog] = [], allRoutes: [Route] = []) -> WeightedScorer {
        WeightedScorer(
            factors: [
                TimeBudgetFactor(preferences: preferences),
                WindFactor(preferences: preferences),
                TemperatureFactor(preferences: preferences),
                SkyFactor(preferences: preferences),
                RainFactor(preferences: preferences),
                SurfaceMatchFactor(),
                IntentFactor(),
                NoveltyFactor(preferences: preferences, rideLogs: rideLogs, allRoutes: allRoutes)
            ],
            weights: Dictionary(uniqueKeysWithValues: RideFactor.allCases.map { ($0, 1.0) })
        )
    }

    // MARK: - Windy day flips route direction preference

    @Test("a windy day flips which direction of an out-and-back wins")
    func windyDayFlipsDirectionPreference() {
        // Both loops are identical apart from which leg comes first, so
        // every factor besides wind scores them identically.
        let tailwindHome = route(
            "Tailwind Home",
            bearingSegments: [
                BearingSegment(bearingDegrees: 0, lengthKm: 5),
                BearingSegment(bearingDegrees: 180, lengthKm: 5),
            ]
        )
        let headwindHome = route(
            "Headwind Home",
            bearingSegments: [
                BearingSegment(bearingDegrees: 180, lengthKm: 5),
                BearingSegment(bearingDegrees: 0, lengthKm: 5),
            ]
        )

        func context(windSpeedKph: Double) -> DailyContext {
            DailyContext(
                date: fixedDate,
                startLocation: start,
                hoursAvailable: 3,
                intent: .easy,
                bike: Bike(name: "Road Bike", type: .road),
                hourlyForecast: [
                    HourlyWeather(
                        time: fixedDate, temperatureC: 16, windSpeedKph: windSpeedKph,
                        windDirectionDegrees: 0, precipitationChance: 0, cloudCover: 0.3
                    )
                ]
            )
        }

        // Isolate wind within the real WeightedScorer machinery — the other
        // seven factors tie for these two otherwise-identical routes, so
        // giving them nonzero weight would only dilute the signal being
        // tested without changing which route wins.
        var windOnlyWeights = Dictionary(uniqueKeysWithValues: RideFactor.allCases.map { ($0, 0.0) })
        windOnlyWeights[.wind] = 1.0
        let scorer = WeightedScorer(
            factors: fullScorer(preferences: preferences()).factors,
            weights: windOnlyWeights
        )

        let calmRanking = scorer.rank(routes: [tailwindHome, headwindHome], context: context(windSpeedKph: 2))
        #expect(abs(calmRanking[0].score - calmRanking[1].score) < 0.05)

        let windyRanking = scorer.rank(routes: [tailwindHome, headwindHome], context: context(windSpeedKph: 35))
        #expect(windyRanking.first?.route.name == "Tailwind Home")
        #expect(windyRanking.first!.score - windyRanking.last!.score > 0.1)
    }

    // MARK: - Short time window drops far routes

    @Test("a short time window drops far-away routes")
    func shortWindowDropsFarRoutes() {
        // ~1 degree latitude is ~111km; "far" is well outside a reasonable
        // drive for a short ride, "near" is a five-minute hop.
        let near = route("Near", distanceKm: 30, start: Coordinate(latitude: 51.05, longitude: -1.0))
        let far = route("Far", distanceKm: 30, start: Coordinate(latitude: 51.8, longitude: -1.0))
        let factor = TimeBudgetFactor(preferences: preferences())

        func context(hoursAvailable: Double) -> DailyContext {
            DailyContext(date: fixedDate, startLocation: start, hoursAvailable: hoursAvailable, intent: .easy, bike: Bike(name: "Bike", type: .road))
        }

        let shortWindow = context(hoursAvailable: 3)
        let nearShort = factor.score(route: near, context: shortWindow).value
        let farShort = factor.score(route: far, context: shortWindow).value
        #expect(nearShort > 0.5)
        #expect(farShort < 0.3)
        #expect(nearShort > farShort)

        // The same far route is fine once there's enough time for the drive.
        let longWindow = context(hoursAvailable: 12)
        let farLong = factor.score(route: far, context: longWindow).value
        #expect(farLong > 0.7)
    }

    // MARK: - Novelty decay + geometric overlap

    @Test("novelty decays from stale toward fresh the longer ago a route was ridden")
    func noveltyDecayWorks() {
        let loop = route("Loop", distanceKm: 20)
        let context = DailyContext(date: fixedDate, startLocation: start, hoursAvailable: 3, intent: .easy, bike: Bike(name: "Bike", type: .road))
        let seekNovelty = preferences()
        var seekPrefs = seekNovelty
        seekPrefs.noveltyDial = 1.0

        func noveltyValue(daysAgo: Double?) -> Double {
            let logs: [RideLog] = daysAgo.map { [RideLog(routeID: loop.id, date: fixedDate.addingTimeInterval(-$0 * 86400))] } ?? []
            return NoveltyFactor(preferences: seekPrefs, rideLogs: logs, allRoutes: [loop]).score(route: loop, context: context).value
        }

        let riddenYesterday = noveltyValue(daysAgo: 1)
        let riddenTwoWeeksAgo = noveltyValue(daysAgo: 14)
        let riddenTwoMonthsAgo = noveltyValue(daysAgo: 60)
        let neverRidden = noveltyValue(daysAgo: nil)

        #expect(riddenYesterday < riddenTwoWeeksAgo)
        #expect(riddenTwoWeeksAgo < riddenTwoMonthsAgo)
        #expect(riddenTwoMonthsAgo < neverRidden)
        #expect(neverRidden == 1.0)
    }

    @Test("novelty is depressed by geometric overlap with a recently ridden route, not just an exact rematch")
    func noveltyOverlapDepressesScore() {
        let sharedLine = (0...5).map { Coordinate(latitude: 51.0 + Double($0) * 0.01, longitude: -1.0) }
        let distantLine = (0...5).map { Coordinate(latitude: 55.0 + Double($0) * 0.01, longitude: -3.0) }

        let riddenRoute = route("Ridden", coordinates: sharedLine)
        let overlappingRoute = route("Overlapping", coordinates: sharedLine) // same roads, different route
        let distinctRoute = route("Distinct", coordinates: distantLine)

        let context = DailyContext(date: fixedDate, startLocation: start, hoursAvailable: 3, intent: .easy, bike: Bike(name: "Bike", type: .road))
        var seekPrefs = preferences()
        seekPrefs.noveltyDial = 1.0
        let riddenYesterday = [RideLog(routeID: riddenRoute.id, date: fixedDate.addingTimeInterval(-1 * 86400))]
        let allRoutes = [riddenRoute, overlappingRoute, distinctRoute]

        let overlappingScore = NoveltyFactor(preferences: seekPrefs, rideLogs: riddenYesterday, allRoutes: allRoutes)
            .score(route: overlappingRoute, context: context).value
        let distinctScore = NoveltyFactor(preferences: seekPrefs, rideLogs: riddenYesterday, allRoutes: allRoutes)
            .score(route: distinctRoute, context: context).value

        #expect(overlappingScore < distinctScore)
        #expect(distinctScore == 1.0)
    }

    // MARK: - Intent reweighting changes ranking

    @Test("switching ride intent changes which route ranks first")
    func intentReweightingChangesRanking() {
        let shortFlat = route("Short Flat", distanceKm: 15, elevationGainM: 50)
        let longHilly = route("Long Hilly", distanceKm: 70, elevationGainM: 1400)
        let scorer = WeightedScorer(factors: [IntentFactor()], weights: [.intent: 1])

        func context(intent: RideIntent) -> DailyContext {
            DailyContext(date: fixedDate, startLocation: start, hoursAvailable: 8, intent: intent, bike: Bike(name: "Bike", type: .road))
        }

        let easyRanking = scorer.rank(routes: [shortFlat, longHilly], context: context(intent: .easy))
        let trainingRanking = scorer.rank(routes: [shortFlat, longHilly], context: context(intent: .training))

        #expect(easyRanking.first?.route.name == "Short Flat")
        #expect(trainingRanking.first?.route.name == "Long Hilly")
    }

    // MARK: - Best day recommendation

    private func dayContext(day: Int, temperatureC: Double) -> DailyContext {
        let date = fixedDate.addingTimeInterval(Double(day) * 86400)
        return DailyContext(
            date: date, startLocation: start, hoursAvailable: 3, intent: .easy, bike: Bike(name: "Bike", type: .road),
            hourlyForecast: [HourlyWeather(time: date, temperatureC: temperatureC, windSpeedKph: 5, windDirectionDegrees: 0, precipitationChance: 0, cloudCover: 0.3)]
        )
    }

    @Test("the scan recommends the standout day of the next ten")
    func bestDayScanPicksStandout() {
        let loop = route("Loop", distanceKm: 20)
        let scorer = WeightedScorer(factors: [TemperatureFactor(preferences: preferences())], weights: [.temperature: 1])

        // Preferred range defaults to 10...22C; day 2 is a perfect 16C, the rest are poor.
        let days = (0..<10).map { dayContext(day: $0, temperatureC: $0 == 2 ? 16 : 30) }

        let recommendation = BestDayScan.recommend(for: loop, contexts: days, scorer: scorer)
        #expect(recommendation?.context.date == days[2].date)
        #expect(recommendation?.tier.isWorthRiding == true)
        #expect(recommendation?.factorScores.isEmpty == false)
    }

    @Test("ties go to the earliest day — no reason to wait for the same conditions")
    func bestDayScanTieBreaksEarly() {
        let loop = route("Loop", distanceKm: 20)
        let scorer = WeightedScorer(factors: [TemperatureFactor(preferences: preferences())], weights: [.temperature: 1])

        let days = (0..<10).map { dayContext(day: $0, temperatureC: 16) }
        let recommendation = BestDayScan.recommend(for: loop, contexts: days, scorer: scorer)
        #expect(recommendation?.context.date == days[0].date)
    }

    @Test("when every day is bad the recommendation is a D tier — don't ride")
    func bestDayScanRecommendsRestWhenAllBad() {
        let loop = route("Loop", distanceKm: 20)
        let scorer = WeightedScorer(factors: [TemperatureFactor(preferences: preferences())], weights: [.temperature: 1])

        // 40C every day: far outside the 10...22C preference.
        let days = (0..<10).map { dayContext(day: $0, temperatureC: 40) }
        let recommendation = BestDayScan.recommend(for: loop, contexts: days, scorer: scorer)
        #expect(recommendation?.tier == RideTier.d)
        #expect(recommendation?.tier.isWorthRiding == false)
    }

    @Test("tier boundaries map scores to S/A/B/C/D")
    func tierBoundaries() {
        #expect(RideTier(score: 1.0) == .s)
        #expect(RideTier(score: 0.85) == .s)
        #expect(RideTier(score: 0.84) == .a)
        #expect(RideTier(score: 0.70) == .a)
        #expect(RideTier(score: 0.69) == .b)
        #expect(RideTier(score: 0.55) == .b)
        #expect(RideTier(score: 0.54) == .c)
        #expect(RideTier(score: 0.40) == .c)
        #expect(RideTier(score: 0.39) == .d)
        #expect(RideTier(score: 0) == .d)
        #expect(RideTier(score: 0.9).isWorthRiding && !RideTier(score: 0.1).isWorthRiding)
    }
}

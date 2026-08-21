import Foundation
import Testing
import Models
@testable import Engine

@Suite("Best window scan")
struct BestWindowScanTests {
    // A fixed UTC calendar so candidate math never depends on the machine's zone.
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private let day = Date(timeIntervalSince1970: 1_750_032_000) // 2025-06-16 00:00 UTC

    private func hour(_ h: Int) -> Date { day.addingTimeInterval(Double(h) * 3600) }

    @Test func candidatesSpanTheRidingWindowMinusTheRide() {
        let starts = BestWindowScan.candidateStarts(
            on: day, ridingWindowMinutes: (8 * 60)...(18 * 60), hoursAvailable: 3, calendar: calendar
        )
        #expect(starts.first == hour(8))
        #expect(starts.last == hour(15)) // 15:00 + 3h ride = 18:00 close
        #expect(starts.count == 8)
    }

    @Test func backByClampsTheClose() {
        let starts = BestWindowScan.candidateStarts(
            on: day, ridingWindowMinutes: (8 * 60)...(18 * 60), hoursAvailable: 3,
            backBy: hour(14), calendar: calendar
        )
        #expect(starts.last == hour(11))
    }

    @Test func earliestSnapsUpToTheNextWholeHour() {
        let starts = BestWindowScan.candidateStarts(
            on: day, ridingWindowMinutes: (8 * 60)...(18 * 60), hoursAvailable: 3,
            earliest: hour(9).addingTimeInterval(600), calendar: calendar
        )
        #expect(starts.first == hour(10))
    }

    @Test func windowShorterThanRideStillYieldsItsOpening() {
        let starts = BestWindowScan.candidateStarts(
            on: day, ridingWindowMinutes: (8 * 60)...(10 * 60), hoursAvailable: 4, calendar: calendar
        )
        #expect(starts == [hour(8)])
    }

    @Test func bestPicksTheCalmestStartAndRanksAllRoutesThere() {
        // Wind falls off through the day; the tailwind-agnostic straight-line
        // route scores best late, so the scan should land on the last start.
        let route = Route(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            name: "Loop", distanceKm: 20, elevationGainM: 0,
            surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 20]),
            suggestedBikeType: Bike.samples[0].type,
            bearingSegments: [BearingSegment(bearingDegrees: 0, lengthKm: 20)]
        )
        let preferences = RiderPreferences(maxWindKph: 20, speedKphBySurface: [.paved: 20], climbingPenaltyMinutesPer100m: 0)
        let scorer = WeightedScorer(factors: [WindFactor(preferences: preferences)], weights: [.wind: 1])

        let hours = (0..<24).map { h in
            HourlyWeather(
                time: hour(h), temperatureC: 15,
                windSpeedKph: max(40 - Double(h) * 3, 2), // headwind from the north all day
                windDirectionDegrees: 0, precipitationChance: 0, cloudCover: 0.2
            )
        }
        let starts = [hour(8), hour(11), hour(14)]
        let result = BestWindowScan.best(starts: starts, scorer: scorer) { start in
            [(route, DailyContext(
                date: start, startLocation: Coordinate(latitude: 51, longitude: -1),
                hoursAvailable: 1, intent: .easy, bike: Bike.samples[0], hourlyForecast: hours
            ))]
        }

        #expect(result?.start == hour(14))
        #expect(result?.ranked.count == 1)
    }
}

import XCTest
import Models

/// The widget's snapshot of the sample board, and its ride-time line (docs/redesign/README.md §8).
final class RideWidgetSnapshotTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        return calendar
    }()
    private let units = RideWidgetSnapshot.Units(distance: .metric, speed: .metric, temperature: nil)

    private func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    func testMapsTheSampleBoard() throws {
        let snapshot = RideWidgetSnapshot(board: .sample, tracked: nil, units: units)
        XCTAssertEqual(snapshot.days.count, 5)
        XCTAssertEqual(snapshot.bestDay, date(14, 0))
        let wednesday = try XCTUnwrap(snapshot.days[0].ride)
        XCTAssertEqual(wednesday.name, "Hilly Loop")
        XCTAssertEqual(wednesday.score, 86)
        XCTAssertEqual(wednesday.hours.count, 4)
        XCTAssertLessThanOrEqual(wednesday.loop.count, 240)
        XCTAssertEqual(snapshot.days[2].note, "Rain from dawn to dusk")
        XCTAssertNil(snapshot.tracked)

        let data = try JSONEncoder().encode(snapshot)
        XCTAssertEqual(try JSONDecoder().decode(RideWidgetSnapshot.self, from: data), snapshot)
    }

    func testTracksWhatChanged() throws {
        let pick = RideBoard.sample.picks[0]
        let tracked = TrackedRide(id: "t", routeId: pick.route.id, start: pick.start, finish: pick.finish, originalScore: 84, latestScore: 86,
                                  check: .checked(at: date(14, 7), changes: [.standard(.gust, actual: 48, limit: 45), .score(2)]))
        let snapshot = RideWidgetSnapshot(board: .sample, tracked: tracked, units: units)
        let shown = try XCTUnwrap(snapshot.tracked)
        XCTAssertEqual(shown.ride.name, "Hilly Loop")
        XCTAssertEqual(shown.change, 2)
        XCTAssertEqual(shown.warnings, [.wind])
        XCTAssertEqual(shown.check, .changed)

        // Under way, the board has moved on: the last snapshot's ride stays until it's over.
        var board = RideBoard.sample
        board.picks.removeFirst()
        board.days.removeFirst()
        XCTAssertEqual(RideWidgetSnapshot(board: board, tracked: tracked, units: units, previous: snapshot).tracked, shown)
        XCTAssertNotNil(snapshot.trackedRide(at: date(14, 13, 59)))
        XCTAssertNil(snapshot.trackedRide(at: date(14, 14)))
    }

    func testPagesDays() {
        let snapshot = RideWidgetSnapshot(board: .sample, tracked: nil, units: units) // Wed 14 – Sun 18, best Wed
        XCTAssertEqual(snapshot.day(at: date(13, 18), paged: nil, calendar: calendar)?.date, date(14, 0))
        XCTAssertEqual(snapshot.day(at: date(13, 18), paged: date(17, 0), calendar: calendar)?.date, date(17, 0))
        // Wednesday's gone: the paged day is past, so the first day left.
        XCTAssertEqual(snapshot.day(at: date(15, 8), paged: date(14, 0), calendar: calendar)?.date, date(15, 0))
        XCTAssertNil(snapshot.day(at: date(19, 8), paged: nil, calendar: calendar))
    }

    func testRideTime() throws {
        let ride = try XCTUnwrap(RideWidgetSnapshot(board: .sample, tracked: nil, units: units).days[0].ride) // Wed 14, 09:00–12:00
        let locale = Locale(identifier: "en_GB")
        func time(_ now: Date, short: Bool = false) -> String { ride.rideTime(at: now, short: short, calendar: calendar, locale: locale) }
        XCTAssertEqual(time(date(12, 18)), "Wed 09:00 · ~3h ride")
        XCTAssertEqual(time(date(12, 18), short: true), "Wed 09:00 · ~3h")
        XCTAssertEqual(time(date(13, 18)), "Tomorrow 09:00 · ~3h ride")
        XCTAssertEqual(time(date(13, 18), short: true), "Tmrw 09:00 · ~3h")
        XCTAssertEqual(time(date(14, 7)), "09:00 → ~12:00 · ~3h ride")
        XCTAssertEqual(time(date(14, 7), short: true), "09:00 · ~3h ride")
        XCTAssertEqual(time(date(14, 10, 20)), "1h 40m to go · back ~12:00")
        XCTAssertEqual(time(date(14, 10, 20), short: true), "1h 40m to go")
        XCTAssertEqual(time(date(14, 12)), "Ride over")
        XCTAssertEqual(RideWidgetSnapshot.Ride.hoursMinutes(45), "45m")
    }
}

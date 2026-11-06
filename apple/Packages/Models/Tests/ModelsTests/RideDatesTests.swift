import XCTest
import Domain

final class RideDatesTests: XCTestCase {
    private let london = TimeZone(identifier: "Europe/London")!
    private let taipei = TimeZone(identifier: "Asia/Taipei")!
    private let locale = Locale(identifier: "en_GB")
    private func date(_ text: String) -> Date { try! Date(text, strategy: .iso8601) }

    func testUKRideViewedFromTaiwan() {
        let phoneClock = Date.FormatStyle(locale: locale, timeZone: taipei).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
        let leave = date("2026-11-08T14:00:00Z"), back = date("2026-11-08T15:45:00Z")
        XCTAssertEqual(leave.formatted(phoneClock), "22:00")
        XCTAssertEqual(leave.formatted(phoneClock, in: london), "14:00")
        XCTAssertEqual(back.formatted(phoneClock, in: london), "15:45")
        // Named zones use the ride date's DST rules, not the current offset.
        XCTAssertEqual(date("2026-07-08T13:00:00Z").formatted(phoneClock, in: london), "14:00")
    }

    func testRideDayDoesNotChangeAtTheViewersMidnight() {
        let instant = date("2026-11-08T17:00:00Z")
        let phoneDay = Date.FormatStyle(locale: locale, timeZone: taipei).weekday(.wide).day().month(.wide)
        XCTAssertEqual(instant.formatted(phoneDay), "Monday 9 November")
        XCTAssertEqual(instant.formatted(phoneDay, in: london), "Sunday 8 November")
        let ukClock = Date.FormatStyle(locale: locale, timeZone: london).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
        XCTAssertEqual(date("2026-11-08T01:00:00Z").formatted(ukClock, in: taipei), "09:00")
    }

    func testWidgetsPersistRideZoneAndKeepTheLocalDay() throws {
        var board = RideBoard.sample
        board.timeZone = "Asia/Taipei"
        var pick = board.picks[0]
        pick.timeZone = board.timeZone
        pick.start = date("2026-11-08T01:00:00Z")
        pick.finish = date("2026-11-08T04:00:00Z")
        board.picks = [pick]
        board.days = [.init(date: date("2026-11-07T16:00:00Z"), best: pick, sky: .sunny)]
        let snapshot = RideWidgetSnapshot(board: board, tracked: nil, units: .init(distance: .metric, speed: .metric, temperature: nil))
        let restored = try JSONDecoder().decode(RideWidgetSnapshot.self, from: JSONEncoder().encode(snapshot))
        let now = date("2026-11-07T23:00:00Z") // Sunday morning in Taiwan, Saturday in the UK.
        let ride = try XCTUnwrap(restored.day(at: now, paged: nil)?.ride)
        XCTAssertEqual(ride.rideTime(at: now, locale: locale), "09:00 → ~12:00 · ~3h ride")
        XCTAssertNil(restored.day(at: date("2026-11-08T16:00:00Z"), paged: nil))
    }

    func testOlderWidgetSnapshotsUseTheirOriginalUKZone() throws {
        let snapshot = RideWidgetSnapshot(board: .sample, tracked: nil, units: .init(distance: .metric, speed: .metric, temperature: nil))
        let data = try JSONEncoder().encode(snapshot)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "timeZone")
        var days = try XCTUnwrap(object["days"] as? [[String: Any]])
        for index in days.indices {
            if var ride = days[index]["ride"] as? [String: Any] {
                ride.removeValue(forKey: "timeZone")
                days[index]["ride"] = ride
            }
        }
        object["days"] = days
        let restored = try JSONDecoder().decode(RideWidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(restored.rideTimeZone, london)
        XCTAssertEqual(restored.days.first?.ride?.rideTimeZone, london)
    }
}

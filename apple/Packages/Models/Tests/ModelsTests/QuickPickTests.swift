import XCTest
import Domain

/// Quick picks resolve as the extension's `planningDates` does (extension/ui/format.ts).
final class QuickPickTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        return calendar
    }()

    private func days(_ pick: RideWindow.QuickPick, from day: Int) -> [Int] {
        let today = calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: 9))!
        return pick.days(from: today, calendar: calendar).map { calendar.component(.day, from: $0) }
    }

    func testResolvesFromTuesday13October() {
        XCTAssertEqual(days(.today, from: 13), [13])
        XCTAssertEqual(days(.tomorrow, from: 13), [14])
        XCTAssertEqual(days(.next, from: 13), [14, 15, 16, 17, 18])
        XCTAssertEqual(days(.weekend, from: 13), [17, 18])
    }

    func testWeekendOnTheWeekend() {
        XCTAssertEqual(days(.weekend, from: 17), [17, 18]) // Saturday
        XCTAssertEqual(days(.weekend, from: 18), [18]) // Sunday
        XCTAssertEqual(days(.weekend, from: 19), [24, 25]) // Monday
    }
}

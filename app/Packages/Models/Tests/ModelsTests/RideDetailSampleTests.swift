import XCTest
import Models

/// The sample detail for the board's best pick is what the canvas shows (docs/redesign/README.md §2).
final class RideDetailSampleTests: XCTestCase {
    func testBestPickMatchesTheCanvas() {
        let board = RideBoard.sample
        let detail = RideDetail.sample(for: board.picks[0], on: board)
        let best = detail.departures[0]

        XCTAssertEqual(detail.departures.map(\.score), [86, 82, 74, 64])
        XCTAssertEqual(detail.notes.map(\.text), ["Starts at 9°, a degree under your ideal range.", "Headwind for the last 9 km back into town."])
        XCTAssertEqual(best.hours.map(\.temperatureC), [9, 11, 13, 14])
        XCTAssertEqual(best.hours.map(\.windKph), [14, 15, 17, 16])
        XCTAssertEqual(best.hours.map(\.gustKph), [24, 26, 28, 27])
        XCTAssertEqual(best.wind.map(\.endKm), [32, 42, 51])
        XCTAssertEqual(detail.elevation.map(\.metres).max(), 186)
        XCTAssertEqual(best.factors.map(\.score), [100, 94, 92, 88, 81, 76, 70, 60])
        XCTAssertEqual(best.factors.map(\.reason), [
            "Dry throughout. The highest chance of rain is 5%.",
            "Tailwind for 62% of the distance. Gusts peak at 28 km/\u{2060}h, under your 45 km/\u{2060}h limit.",
            "About 3 hours. You're back by 12:00, long before sunset at 18:04.",
            "Sealed roads all the way, right for your road bike.",
            "9° at the start, 14° by the finish. Your ideal range is 10–22°.",
            "Sunny spells, about 40% cloud cover.",
            "You wanted a steady ride. 640 m of climbing makes it a harder one.",
            "You rode it 15 days ago, on 29 September.",
        ])
    }
}

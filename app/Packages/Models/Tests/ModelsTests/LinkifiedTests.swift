import XCTest
import Models

final class LinkifiedTests: XCTestCase {
    private func links(in attributed: AttributedString) -> [URL] {
        attributed.runs.compactMap(\.link)
    }

    func testBareURLBecomesLink() {
        let attributed = AttributedString.linkified("Route notes: https://strava.com/routes/42 — enjoy")
        XCTAssertEqual(links(in: attributed), [URL(string: "https://strava.com/routes/42")!])
    }

    func testEmojiBeforeURLKeepsRangeAligned() {
        // A multibyte grapheme ahead of the URL would break UTF-16/Character
        // offset mapping if the two counts diverged — assert the link still
        // lands exactly on the URL text.
        let attributed = AttributedString.linkified("🚵 ride https://example.com now")
        let linked = attributed.runs.first { $0.link != nil }
        XCTAssertEqual(linked?.link, URL(string: "https://example.com")!)
        XCTAssertEqual(linked.map { String(attributed[$0.range].characters) }, "https://example.com")
    }

    func testPlainTextHasNoLinks() {
        XCTAssertTrue(links(in: AttributedString.linkified("just a hilly loop, no links here")).isEmpty)
        XCTAssertTrue(links(in: AttributedString.linkified("")).isEmpty)
    }
}

import XCTest

final class RideOnUITests: XCTestCase {
    func testTabsExistAndTodayShowsPlaceholderCard() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        XCTAssertTrue(app.buttons["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Routes"].exists)
        XCTAssertTrue(app.buttons["You"].exists)

        XCTAssertTrue(app.staticTexts["today-placeholder-card"].exists)
    }

    // ponytail: file-picker UI automation is flaky (system sheet, no stable
    // accessibility hooks across simulators) — seed a route via fixture-world
    // instead of driving `.fileImporter`, per Phase 2 spec.
    func testRoutesTabShowsSeededImportedRoute() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        app.buttons["Routes"].tap()

        XCTAssertTrue(app.staticTexts["Chilterns Loop"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '42.0 km'")).firstMatch.exists)
    }
}

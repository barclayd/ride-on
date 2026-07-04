import XCTest

final class RideOnUITests: XCTestCase {
    func testTabsExistAndTodayShowsARecommendation() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        XCTAssertTrue(app.buttons["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Routes"].exists)
        XCTAssertTrue(app.buttons["You"].exists)

        // Today defaults to the card stack (fixture weather + seeded routes
        // always clear the rest-day threshold), so a scored card is present.
        XCTAssertTrue(app.buttons["today-card"].firstMatch.waitForExistence(timeout: 5))
    }

    func testTabNavigationShowsEachScreen() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        app.buttons["Routes"].tap()
        XCTAssertTrue(app.navigationBars["Routes"].waitForExistence(timeout: 5))

        app.buttons["You"].tap()
        XCTAssertTrue(app.navigationBars["You"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Weights"].exists)

        app.buttons["Today"].tap()
        XCTAssertTrue(app.buttons["today-card"].firstMatch.waitForExistence(timeout: 5))
    }

    func testTodayCardOpensRouteDetail() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        let card = app.buttons["today-card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        card.tap()

        XCTAssertTrue(app.buttons["Export GPX"].waitForExistence(timeout: 5))
    }

    func testTodayCardSwipeUpOpensBreakdownSheet() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        let card = app.buttons["today-card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        card.swipeUp()

        XCTAssertTrue(app.navigationBars["Why This Ride"].waitForExistence(timeout: 5))
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

    func testRoutesSearchFiltersList() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        app.buttons["Routes"].tap()
        XCTAssertTrue(app.staticTexts["Chilterns Loop"].waitForExistence(timeout: 5))

        let searchField = app.searchFields["Search routes"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 5))
        searchField.tap()
        searchField.typeText("Chilterns")

        XCTAssertTrue(app.staticTexts["Chilterns Loop"].waitForExistence(timeout: 5))

        searchField.buttons["Clear text"].tap()
        searchField.typeText("zzz-no-such-route")

        XCTAssertFalse(app.staticTexts["Chilterns Loop"].exists)
    }
}

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
        // ponytail: distance is now locale-formatted (UnitFormat, km vs mi) —
        // the simulator's default locale can be en_US, which would render
        // this route's distance in miles and break the "42.0 km" assertion
        // below. Pin to a metric, period-decimal locale (en_AU) so the
        // assertion holds regardless of the host machine's simulator locale;
        // app strings are all hardcoded English so language is unaffected.
        app.launchArguments += ["--fixture-world", "-AppleLocale", "en_AU", "-AppleLanguages", "(en)"]
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

    // MARK: - Onboarding (Phase 5)
    //
    // `--fixture-world` alone defaults to "onboarding already completed"
    // (`PreferencesStore`), so every test above keeps landing straight on
    // Today with zero changes. `--reset-onboarding` is the one launch
    // argument that forces onboarding back on, deterministically, for these
    // two tests.

    func testOnboardingHappyPathThroughAllStepsLandsOnToday() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world", "--reset-onboarding"]
        app.launch()

        // Step 0: welcome — not skippable, no Skip button.
        XCTAssertTrue(app.staticTexts["Ride On"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Skip"].exists)
        app.buttons["Continue"].tap()

        // Step 1: temperature dial.
        XCTAssertTrue(app.staticTexts["Temperature"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Step 2: sun dial — change the selection to exercise the reactive
        // ambiance crossfade, then continue.
        XCTAssertTrue(app.staticTexts["Sun"].waitForExistence(timeout: 5))
        app.buttons["Seek"].tap()
        app.buttons["Continue"].tap()

        // Step 3: rain dial.
        XCTAssertTrue(app.staticTexts["Rain Tolerance"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Step 4: wind dial.
        XCTAssertTrue(app.staticTexts["Max Wind"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Step 5: novelty dial.
        XCTAssertTrue(app.staticTexts["Novelty"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Step 6: Strava connect (fixture client).
        XCTAssertTrue(app.staticTexts["Connect Strava"].waitForExistence(timeout: 5))
        app.buttons["Connect Strava"].tap()
        XCTAssertTrue(app.buttons["Connected"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Step 7: speed prefill review.
        XCTAssertTrue(app.staticTexts["Your Speeds"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Step 8: finish.
        XCTAssertTrue(app.staticTexts["You're All Set"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        // Lands on a working Today.
        XCTAssertTrue(app.buttons["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["today-card"].firstMatch.waitForExistence(timeout: 5))
    }

    func testOnboardingSkipPathLandsOnToday() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world", "--reset-onboarding"]
        app.launch()

        // Welcome has no skip; every step after it does.
        XCTAssertTrue(app.staticTexts["Ride On"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()

        for _ in 0..<7 {
            XCTAssertTrue(app.buttons["Skip"].waitForExistence(timeout: 5))
            app.buttons["Skip"].tap()
        }

        // Last step (finish) is also skippable, and behaves the same as
        // Continue there.
        XCTAssertTrue(app.staticTexts["You're All Set"].waitForExistence(timeout: 5))
        app.buttons["Skip"].tap()

        XCTAssertTrue(app.buttons["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["today-card"].firstMatch.waitForExistence(timeout: 5))
    }

    // MARK: - Performance (Phase 7)

    /// Cold-launch time, fixture-world (no live network to skew the number).
    /// Not a pass/fail gate — `measure` just records the metric to the test
    /// log/Xcode Report Navigator so regressions are visible over time.
    func testColdLaunchPerformance() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            app.launch()
        }
    }
}

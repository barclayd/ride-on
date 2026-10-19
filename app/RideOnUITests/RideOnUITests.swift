import XCTest

@MainActor
final class RideOnUITests: XCTestCase {
    func testTabsExistAndRidesShowsTheBestPick() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        XCTAssertTrue(app.buttons["Rides"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Routes"].exists)
        XCTAssertTrue(app.buttons["Preferences"].exists)

        // Rides renders `RideBoard.sample` until the API pass: Hilly Loop is the window's best.
        XCTAssertTrue(heroTitle(in: app, startingWith: "Hilly Loop").waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["rides-route-row"].firstMatch.exists)
    }

    func testTabNavigationShowsEachScreen() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        app.buttons["Routes"].tap()
        XCTAssertTrue(app.staticTexts["Shortlist"].waitForExistence(timeout: 5))

        app.buttons["Preferences"].tap()
        XCTAssertTrue(app.staticTexts["Ideal Temperature"].waitForExistence(timeout: 5))

        app.buttons["Rides"].tap()
        XCTAssertTrue(heroTitle(in: app, startingWith: "Hilly Loop").waitForExistence(timeout: 5))
    }

    func testStravaShowsCompletedRidesAndDisconnectsInFixtureWorld() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()
        app.buttons["Preferences"].tap()
        let strava = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Strava'")).firstMatch
        for _ in 0..<6 {
            if strava.exists && strava.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(strava.waitForExistence(timeout: 5))
        strava.tap()
        XCTAssertTrue(app.staticTexts["Morning Gravel"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.links["View on Strava"].exists || app.buttons["View on Strava"].exists)
        app.buttons["Disconnect from Ride On"].tap()
        XCTAssertTrue(app.buttons["Disconnect"].waitForExistence(timeout: 5))
        app.buttons["Disconnect"].tap()
        XCTAssertTrue(app.buttons["Connect with Strava"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Morning Gravel"].exists)
    }

    func testRidesDayStripSwapsTheHeroToThatDaysBest() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        XCTAssertTrue(heroTitle(in: app, startingWith: "Hilly Loop").waitForExistence(timeout: 5))
        app.buttons["Thursday"].tap()
        XCTAssertTrue(heroTitle(in: app, startingWith: "Potters Bar").waitForExistence(timeout: 5))
        // Friday is rained off: shown, but not a button.
        XCTAssertFalse(app.buttons["Friday"].exists)
    }

    func testHeroOpensRideDetailAndADepartureRescoresIt() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        let hero = heroTitle(in: app, startingWith: "Hilly Loop")
        XCTAssertTrue(hero.waitForExistence(timeout: 5))
        hero.tap()
        XCTAssertTrue(app.staticTexts["Why It Scored 86"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Sky on the Ride"].exists)
        XCTAssertTrue(app.staticTexts["Wind on the Ride"].exists)

        // An hour later scores 82; the factors follow the departure.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Wednesday' AND label CONTAINS '10:00'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Why It Scored 82"].waitForExistence(timeout: 5))
    }

    func testBellTracksAndStopsTrackingTheHeroRide() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        // "Track Hilly Loop on …" until tracked, then "Tracking Hilly Loop on …".
        let bell = { (prefix: String) in
            app.buttons.matching(NSPredicate(format: "identifier == 'track-bell' AND label BEGINSWITH %@", prefix)).firstMatch
        }
        XCTAssertTrue(bell("Track ").waitForExistence(timeout: 5))
        bell("Track ").tap()
        XCTAssertTrue(app.staticTexts["Track This Ride"].waitForExistence(timeout: 5))
        app.buttons["Start Tracking"].tap()
        XCTAssertTrue(bell("Tracking ").waitForExistence(timeout: 5))

        bell("Tracking ").tap()
        XCTAssertTrue(app.staticTexts["Tracking This Ride"].waitForExistence(timeout: 5))
        app.buttons["Stop Tracking"].tap()
        XCTAssertTrue(bell("Track ").waitForExistence(timeout: 5))
    }

    /// The hero's title block is one accessibility element whose label starts with the route name.
    private func heroTitle(in app: XCUIApplication, startingWith name: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS 'score'", name)).firstMatch
    }

    // Routes renders `RouteLibrary.sample` until the API pass.
    func testRoutesPanelShowsShortlistLibraryAndHistory() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        app.buttons["Routes"].tap()
        XCTAssertTrue(routeButton(in: app, startingWith: "Hilly Loop").waitForExistence(timeout: 5))
        XCTAssertTrue(routeButton(in: app, startingWith: "Lea Valley Gravel").exists)

        app.buttons["History 8"].tap()
        let footnote = app.staticTexts["Weather is the forecast from when you planned each ride, not what you rode in."]
        app.swipeUp()
        XCTAssertTrue(footnote.waitForExistence(timeout: 5))
    }

    func testRoutesSearchFiltersTheLibrary() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world"]
        app.launch()

        app.buttons["Routes"].tap()
        XCTAssertTrue(routeButton(in: app, startingWith: "Lea Valley Gravel").waitForExistence(timeout: 5))

        let searchField = app.textFields["routes-search"]
        searchField.tap()
        searchField.typeText("Epping")

        XCTAssertTrue(routeButton(in: app, startingWith: "Epping Forest Trails").waitForExistence(timeout: 5))
        XCTAssertFalse(routeButton(in: app, startingWith: "Lea Valley Gravel").exists)
    }

    /// The cycle map behind `--cycle-map` (docs/maps/README.md, WS3), on the fixture world's offline
    /// style: drawn with its attribution, its snapshots on the shortlist cards, and swapped for MapKit
    /// from the style menu.
    func testRoutesCycleMapShowsWithItsAttribution() {
        let app = XCUIApplication()
        app.launchArguments += ["--fixture-world", "--cycle-map"]
        app.launch()

        // `--cycle-map` opens on Routes.
        let map = app.descendants(matching: .any)["cycle-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 5))
        // SwiftUI's `Link`s are buttons to XCUITest.
        XCTAssertTrue(app.buttons["Map data © OpenStreetMap contributors"].exists)
        XCTAssertTrue(app.buttons["Protomaps"].exists)
        XCTAssertTrue(routeButton(in: app, startingWith: "Hilly Loop").exists)

        app.buttons["Map style"].tap()
        app.buttons["Satellite"].tap()
        XCTAssertTrue(map.waitForNonExistence(timeout: 5))
    }

    /// Shortlist cards and panel rows are buttons whose labels start with the route name.
    private func routeButton(in app: XCUIApplication, startingWith name: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
    }

    // MARK: - Onboarding (Phase 5)
    //
    // `--fixture-world` alone defaults to "onboarding already completed"
    // (`PreferencesStore`), so every test above keeps landing straight on
    // the Ride tab with zero changes. `--reset-onboarding` is the one launch
    // argument that forces onboarding back on, deterministically, for these
    // two tests.

    func testOnboardingHappyPathThroughAllStepsLandsOnRides() {
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

        // Lands on a working Ride tab.
        XCTAssertTrue(app.buttons["Rides"].waitForExistence(timeout: 5))
        XCTAssertTrue(heroTitle(in: app, startingWith: "Hilly Loop").waitForExistence(timeout: 5))
    }

    func testOnboardingSkipPathLandsOnRides() {
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

        XCTAssertTrue(app.buttons["Rides"].waitForExistence(timeout: 5))
        XCTAssertTrue(heroTitle(in: app, startingWith: "Hilly Loop").waitForExistence(timeout: 5))
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

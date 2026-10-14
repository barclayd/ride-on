import XCTest
@testable import Services

/// `GET /users/me` → `RiderSettings`, and the `PATCH /users/me` body it saves.
final class RiderSettingsTests: XCTestCase {
    func testReadsUserAndPatchesOnlyWhatTheAppEdits() throws {
        let json = """
            {"user":{"id":"u1","version":7,"weatherProviderId":"met-office",
              "preferenceLevels":{"sunshine":"custom","rain":"light-ok"},
              "settings":{"riding":{"averageSpeedKph":21,"departureStepMinutes":30},
                "units":{"temperature":"C","windSpeed":"kmh"},
                "display":{"unit":"km"},
                "preferences":{"temperature":{"comfortMinC":16,"comfortMaxC":32},
                  "wind":{"comfortableHeadwindKph":16,"comfortableCrosswindKph":16,"comfortableGustKph":30,"crosswindSensitivity":1.3},
                  "recentRides":{"mode":"neutral","lookbackDays":28},"climbing":{"preference":"neutral"},"distance":null,
                  "weights":{"temperature":3},
                  "minimumStandards":{"minimumTemperature":{"kind":"monthly","valuesC":{"1":2,"7":6},"fallbackC":6},
                    "maximumGustKph":55,"maximumPrecipitationRateMmH":2}}}}}
            """
        let response = try JSONDecoder().decode(RiderSettingsStore.UserResponse.self, from: Data(json.utf8))
        let user = response.user
        var settings = RiderSettings(riding: user.settings.riding, preferences: user.settings.preferences, units: user.settings.units,
                                     sunshine: user.preferenceLevels?.sunshine ?? .custom, rain: user.preferenceLevels?.rain ?? .custom)
        XCTAssertEqual(settings.preferences.minimumStandards.minimumTemperature?.isMonthly, true)
        XCTAssertEqual(settings.preferences.minimumStandards.minimumTemperature?.baseC, 6)
        XCTAssertNil(settings.preferences.distance)

        settings.preferences.minimumStandards.maximumGustKph = nil
        let body = try JSONEncoder().encode(RiderSettingsStore.Patch(expectedVersion: user.version, settings))
        let patch = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(patch["expectedVersion"] as? Int, 7)
        let sent = try XCTUnwrap(patch["settings"] as? [String: Any])
        let preferences = try XCTUnwrap(sent["preferences"] as? [String: Any])
        let limits = try XCTUnwrap(preferences["minimumStandards"] as? [String: Any])
        // Removed limits and distance go as explicit nulls; the API only removes on null.
        XCTAssertTrue(preferences["distance"] is NSNull)
        XCTAssertTrue(limits["maximumGustKph"] is NSNull)
        // Untouched by the app, so never sent: weights, the rain-rate limit, a custom level.
        XCTAssertNil(preferences["weights"])
        XCTAssertNil(limits["maximumPrecipitationRateMmH"])
        let levels = try XCTUnwrap(sent["preferenceLevels"] as? [String: Any])
        XCTAssertNil(levels["sunshine"])
        XCTAssertEqual(levels["rain"] as? String, "light-ok")
    }
}

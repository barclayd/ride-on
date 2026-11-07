import XCTest
@testable import Services

/// `GET /users/me` → `RiderSettings`, and the `PATCH /users/me` body it saves.
final class RiderSettingsTests: XCTestCase {
    func testReadsUserAndPatchesOnlyWhatTheAppEdits() throws {
        let json = """
            {"user":{"id":"u1","version":7,"weatherProviderId":"met-office",
              "preferenceLevels":{"sunshine":"custom","rain":"light-ok","crosswind":"high"},
              "settings":{"riding":{"averageSpeedKph":21,"departureStepMinutes":30},
                "units":{"temperature":"C","windSpeed":"kmh"},
                "display":{"unit":"mi"},
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
                                     display: user.settings.display, sunshine: user.preferenceLevels?.sunshine ?? .custom,
                                     rain: user.preferenceLevels?.rain ?? .custom, crosswind: user.preferenceLevels?.crosswind)
        // The rider's own monthly table: chosen months, the fallback for the rest.
        let floor = try XCTUnwrap(settings.preferences.minimumStandards.minimumTemperature)
        XCTAssertEqual(floor.valueC(in: 1), 2)
        XCTAssertEqual(floor.valueC(in: 3), 6)
        XCTAssertNil(RiderSettings.Preferences.TemperatureFloor(kind: "monthly", valuesC: ["7": 8]).valueC(in: 1))
        XCTAssertEqual(RiderSettings.Preferences.TemperatureFloor.monthly(4).valuesC?.count, 12)
        XCTAssertNil(settings.preferences.distance)
        XCTAssertEqual(settings.display?.unit, "mi")
        XCTAssertNil(settings.preferences.temperature.seasonalTolerance)

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
        XCTAssertNil((preferences["temperature"] as? [String: Any])?["seasonalTolerance"])
        XCTAssertNil(limits["maximumPrecipitationRateMmH"])
        let levels = try XCTUnwrap(sent["preferenceLevels"] as? [String: Any])
        XCTAssertNil(levels["sunshine"])
        XCTAssertEqual(levels["rain"] as? String, "light-ok")
        // Crosswind goes as its level, never the raw sensitivity: the API rejects both together.
        XCTAssertEqual(levels["crosswind"] as? String, "high")
        XCTAssertNil((preferences["wind"] as? [String: Any])?["crosswindSensitivity"])
        XCTAssertEqual((sent["display"] as? [String: Any])?["unit"] as? String, "mi")

        // An API older than v0.25.0 has no level, and rejects the key.
        settings.crosswind = nil
        let old = try JSONSerialization.jsonObject(with: JSONEncoder().encode(RiderSettingsStore.Patch(expectedVersion: 7, settings))) as? [String: Any]
        XCTAssertNil(((old?["settings"] as? [String: Any])?["preferenceLevels"] as? [String: Any])?["crosswind"])
    }

    func testReadsLinkedSignInMethods() throws {
        let json = #"{"user":{"email":"dan@example.com","providers":["apple","passkey"]}}"#
        XCTAssertEqual(try JSONDecoder().decode(RiderSettingsStore.AuthResponse.self, from: Data(json.utf8)).user.providers, ["apple", "passkey"])
    }

    func testSeasonalScoringReadsAndSavesBothChoicesWithoutChangingTemperatureLimits() throws {
        for value in ["none", "cooler-winters"] {
            let json = """
                {"comfortMinC":16,"comfortMaxC":32,"seasonalTolerance":"\(value)","coldSensitivity":"high"}
                """
            let temperature = try JSONDecoder().decode(RiderSettings.Preferences.Temperature.self, from: Data(json.utf8))
            XCTAssertEqual(temperature.seasonalTolerance?.rawValue, value)

            var settings = RiderSettings.sample
            settings.preferences.temperature = temperature
            let originalLimits = settings.preferences.minimumStandards
            for choice in [RiderSettings.Preferences.Temperature.SeasonalTolerance.coolerWinters, .disabled] {
                settings.preferences.temperature.seasonalTolerance = choice
                let data = try JSONEncoder().encode(RiderSettingsStore.Patch(expectedVersion: 7, settings))
                let patch = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
                let sent = try XCTUnwrap(patch["settings"] as? [String: Any])
                let preferences = try XCTUnwrap(sent["preferences"] as? [String: Any])
                let temperature = try XCTUnwrap(preferences["temperature"] as? [String: Any])
                XCTAssertEqual(temperature["seasonalTolerance"] as? String, choice.rawValue)
                XCTAssertEqual(temperature["comfortMinC"] as? Double, 16)
                XCTAssertEqual(temperature["comfortMaxC"] as? Double, 32)
                XCTAssertNil(temperature["coldSensitivity"])
                XCTAssertEqual(settings.preferences.minimumStandards, originalLimits)
            }
        }
    }
}

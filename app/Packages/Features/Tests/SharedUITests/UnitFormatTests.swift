import XCTest
import Models
@testable import SharedUI

final class UnitFormatTests: XCTestCase {
    private let gb = Locale(identifier: "en_GB")
    private let us = Locale(identifier: "en_US")
    private let fr = Locale(identifier: "fr_FR")

    func testDistanceRespectsUnitSystem() {
        XCTAssertEqual(UnitFormat.distance(km: 42, system: .metric, locale: gb), "42.0 km")
        XCTAssertEqual(UnitFormat.distance(km: 42, system: .imperial, locale: us), "26.1 mi")
        // fr_FR separates the number and unit with a narrow no-break space
        // (U+202F), not a plain space.
        XCTAssertEqual(UnitFormat.distance(km: 42, system: .metric, locale: fr), "42,0\u{202F}km")
    }

    func testElevationStaysInFeetOrMeters() {
        // The unit must not rescale with magnitude — zero gain previously
        // rendered as "0 in".
        XCTAssertEqual(UnitFormat.elevation(m: 0, system: .imperial, locale: gb), "0 ft")
        XCTAssertEqual(UnitFormat.elevation(m: 0, system: .metric, locale: fr), "0\u{202F}m")
        XCTAssertEqual(UnitFormat.elevation(m: 380, system: .imperial, locale: us), "1,247 ft")
        XCTAssertEqual(UnitFormat.elevation(m: 380, system: .metric, locale: fr), "380\u{202F}m")
    }

    func testSpeedRespectsUnitSystem() {
        XCTAssertEqual(UnitFormat.speed(kph: 25, system: .metric, locale: gb), "25 km/h")
        XCTAssertEqual(UnitFormat.speed(kph: 25, system: .imperial, locale: us), "16 mph")
    }

    func testTemperatureRespectsLocale() {
        // Temperature follows the locale, not the unit toggle — iOS has a
        // per-app °C/°F setting for that.
        XCTAssertEqual(UnitFormat.temperature(c: 18, locale: gb), "18°C")
        XCTAssertEqual(UnitFormat.temperature(c: 18, locale: us), "64°F")
        XCTAssertEqual(UnitFormat.temperature(c: 18, locale: fr), "18\u{202F}°C")
    }
}

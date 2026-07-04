import XCTest
@testable import SharedUI

final class UnitFormatTests: XCTestCase {
    private let gb = Locale(identifier: "en_GB")
    private let us = Locale(identifier: "en_US")
    private let fr = Locale(identifier: "fr_FR")

    func testDistanceRespectsLocale() {
        // UK/US roads are measured in miles even though both are otherwise
        // metric-adjacent locales; France stays km.
        XCTAssertEqual(UnitFormat.distance(km: 42, locale: gb), "26.1 mi")
        XCTAssertEqual(UnitFormat.distance(km: 42, locale: us), "26.1 mi")
        // fr_FR separates the number and unit with a narrow no-break space
        // (U+202F), not a plain space.
        XCTAssertEqual(UnitFormat.distance(km: 42, locale: fr), "42,0\u{202F}km")
    }

    func testElevationStaysInFeetOrMeters() {
        // The unit must not rescale with magnitude — zero gain previously
        // rendered as "0 in".
        XCTAssertEqual(UnitFormat.elevation(m: 0, locale: gb), "0 ft")
        XCTAssertEqual(UnitFormat.elevation(m: 0, locale: fr), "0\u{202F}m")
        XCTAssertEqual(UnitFormat.elevation(m: 380, locale: us), "1,247 ft")
        XCTAssertEqual(UnitFormat.elevation(m: 380, locale: fr), "380\u{202F}m")
    }

    func testTemperatureRespectsLocale() {
        XCTAssertEqual(UnitFormat.temperature(c: 18, locale: gb), "18°C")
        XCTAssertEqual(UnitFormat.temperature(c: 18, locale: us), "64°F")
        XCTAssertEqual(UnitFormat.temperature(c: 18, locale: fr), "18\u{202F}°C")
    }
}

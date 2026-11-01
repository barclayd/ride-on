import XCTest
import Domain

/// "Sky on the Ride" and "Wind on the Ride" follow the extension's sky chip and wind panel.
final class RideBreakdownTests: XCTestCase {
    typealias Sky = RideDetail.SkyBreakdown
    typealias Wind = RideDetail.WindBreakdown

    func testSkySummariesFollowTheExtension() throws {
        let sunny = try XCTUnwrap(Sky.make(ride: [.sunny: 1], hours: [(10, [.sunny: 1]), (10, [.sunny: 1])], categories: [:], partial: false))
        XCTAssertEqual(sunny.summary, "Sunny throughout")
        XCTAssertEqual(sunny.look, .sun)
        XCTAssertEqual(sunny.segments, [Sky.Segment(.sunny, share: 1)])
        XCTAssertEqual(Sky.make(ride: [.sunny: 0.8, .unknown: 0.2], hours: [], categories: [:], partial: true)?.summary, "Sunny where forecast")

        let mixed = try XCTUnwrap(Sky.make(ride: [.sunny: 0.5, .sunnyIntervals: 0.3, .cloud: 0.2],
                                           hours: [(10, [.sunny: 1]), (10, [.sunnyIntervals: 0.6, .cloud: 0.4])],
                                           categories: [:], partial: false))
        XCTAssertEqual(mixed.summary, "Sun and sunny intervals")
        XCTAssertEqual(mixed.segments.map(\.kind), [.sunny, .sunnyIntervals, .cloud])
        XCTAssertEqual(mixed.legend.map(\.kind), [.sunny, .sunnyIntervals, .cloud])
        XCTAssertEqual(Sky.make(ride: [.sunny: 0.05, .sunnyIntervals: 0.6, .cloud: 0.35], hours: [], categories: [:], partial: false)?.summary,
                       "Sunny intervals")

        XCTAssertEqual(Sky.make(ride: [.sunny: 0.1, .cloud: 0.9], hours: [], categories: ["overcast": 0.6, "cloudy": 0.3], partial: false)?.summary,
                       "Overcast")
        XCTAssertEqual(Sky.make(ride: [.cloud: 1], hours: [], categories: ["obscured": 0.7, "cloudy": 0.3], partial: false)?.look, .fog)
        // Showers alone are the forecast grid's to say; nothing known says nothing.
        XCTAssertNil(Sky.make(ride: [.cloud: 1], hours: [], categories: ["lightShowers": 1], partial: false))
        XCTAssertNil(Sky.make(ride: [.unknown: 1], hours: [], categories: [:], partial: true))
    }

    func testWindBlocksLegendAndGusts() {
        let now = Date(timeIntervalSince1970: 0)
        let stretches = [
            Wind.Stretch(.crosswind, from: 0, to: 0.45, fromDegrees: 225, kph: 18, adverseGustKph: 10, start: now, end: now),
            Wind.Stretch(.crosswind, from: 0.45, to: 0.5, fromDegrees: 230, kph: 18, adverseGustKph: 10, start: now, end: now),
            Wind.Stretch(.tailwind, from: 0.5, to: 0.8, fromDegrees: 270, kph: 20, adverseGustKph: 0, start: now, end: now),
            Wind.Stretch(.headwind, from: 0.8, to: 1, fromDegrees: 270, kph: 22, adverseGustKph: 30, start: now, end: now),
        ]
        let speed = { (kph: Double) in "\(Int(kph)) km/h" }
        let gusts = Wind.gusts(peakKph: 34, adverseKph: 30, comfortKph: 25, limitKph: 45, stretches: stretches, roundTrip: true,
                               speed: speed, clock: { _ in "10:00" })
        let wind = Wind(stretches: stretches, averageKph: 20, gusts: gusts, roundTrip: true, exact: true)

        XCTAssertEqual(wind.blocks.map(\.effect), [.crosswind, .tailwind, .headwind])
        XCTAssertEqual(wind.blocks.map(\.label), ["SW", "W", "W"])
        XCTAssertEqual(wind.blocks[0].share, 0.5, accuracy: 1e-9)
        XCTAssertEqual(wind.legend.map(\.effect), [.crosswind, .tailwind, .headwind])
        XCTAssertEqual(wind.runs.map(\.effect), [.crosswind, .tailwind, .headwind])
        XCTAssertEqual(wind.from, ["south-west", "west"])
        XCTAssertNotNil(wind.towardsDegrees)

        XCTAssertEqual(gusts, Wind.Gusts(warn: true, title: "Gusts up to 34 km/h",
                                         text: "Into your face on the way back, 10:00–10:00. Over your 25 km/h comfort."))
        let calm = Wind.gusts(peakKph: 20, adverseKph: 5, comfortKph: 25, limitKph: 45, stretches: stretches, roundTrip: true,
                              speed: speed, clock: { _ in "" })
        XCTAssertEqual(calm, Wind.Gusts(warn: false, title: "Gusts up to 20 km/h", text: "At most 5 km/h against you."))

        let light = Wind(stretches: [Wind.Stretch(.light, from: 0, to: 1, fromDegrees: 90, kph: 6, adverseGustKph: nil, start: now, end: now)],
                         averageKph: 6, gusts: nil, roundTrip: nil, exact: false)
        XCTAssertEqual(light.from, [])
        XCTAssertNil(light.towardsDegrees)
        XCTAssertEqual(light.blocks.map(\.label), [nil])
    }

    func testRoundTripAndResampling() {
        let loop = [Coordinate(latitude: 51.75, longitude: -0.6), Coordinate(latitude: 51.8, longitude: -0.6),
                    Coordinate(latitude: 51.8, longitude: -0.5), Coordinate(latitude: 51.7501, longitude: -0.6)]
        XCTAssertEqual(Wind.isRoundTrip(loop), true)
        XCTAssertEqual(Wind.isRoundTrip(Array(loop.prefix(3))), false)
        XCTAssertNil(Wind.isRoundTrip([]))

        let points = RouteTrace(loop).resampled(5)
        XCTAssertEqual(points.count, 5)
        XCTAssertEqual(points.first, loop.first)
        XCTAssertEqual(points.last, loop.last)
    }
}

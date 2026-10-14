import XCTest
import Models
@testable import Services

/// `POST /recommendations` → `RideBoard`, from a trimmed multi-day response.
final class RideBoardLoaderTests: XCTestCase {
    func testMapsRecommendationOntoBoard() throws {
        let route = "6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01"
        let long = "0b8f7a54-9e7b-4a3c-8f2e-5d6c7b8a9f02"
        let conditions = { (sky: String, rain: String, head: Double) in """
            {"temperatureC":{"minimum":9,"maximum":14},"averageWindSpeedKph":15,"averageHeadwindKph":\(head),
             "averageTailwindKph":6,"averageCrosswindKph":4,"maximumGustKph":28,"maximumPrecipitationProbability":0.05,
             "distanceKm":25,"windDistanceFractions":{"headwind":\(head > 5 ? 0.7 : 0.1),"tailwind":\(head > 5 ? 0.2 : 0.6),"crosswind":0.1},
             "precipitationSummary":"\(rain)","skyConditionDistanceFractions":{"\(sky)":0.8,"cloudy":0.2},"cloudCoverFraction":{"mean":0.4,"maximum":0.6}}
            """ }
        let departure = { (at: String, finish: String, score: Double) in """
            {"departureAt":"\(at)","finishAt":"\(finish)","score":\(score),
             "factors":{"distance":null,"climbing":null,"sunshine":80,"clearSkies":60,"temperature":81,"wind":94,"dryness":100},
             "standards":{"status":"meets"},"conditions":\(conditions("sunnyIntervals", "dry", 1)),
             "rideHours":[{"start":"\(at)","end":"2026-10-14T09:00:00.000Z","conditions":\(conditions("sunny", "dry", 1))},
                          {"start":"2026-10-14T09:00:00.000Z","end":"\(finish)","conditions":\(conditions("cloudy", "light_showers", 9))}],
             "drawbacks":["Some sections are cooler than your comfort range.","Gusts exceed your comfort setting.","Cloud covers more than half the sky on average during this ride."]}
            """ }
        let json = """
            {"generatedAt":"2026-10-13T07:12:00.000Z","timeZone":"Europe/London","range":{"dates":["2026-10-14","2026-10-15"]},
             "rankings":[{"routeId":"\(route)","routeName":"Hilly Loop","distanceKm":51,"ascentM":640,"estimatedDurationMinutes":180,
               "status":"assessed","best":\(departure("2026-10-14T08:00:00.000Z", "2026-10-14T11:00:00.000Z", 85.6)),
               "alternatives":[\(departure("2026-10-15T08:00:00.000Z", "2026-10-15T11:00:00.000Z", 70))]}],
             "unranked":[{"routeId":"\(long)","routeName":"East Anglia","distanceKm":112,"ascentM":null,"estimatedDurationMinutes":425,
               "daylight":{"start":"2026-10-14T06:20:00.000Z","end":"2026-10-14T17:05:00.000Z"},"effectiveWindow":null,
               "status":"no_feasible_departure","best":null,"alternatives":[]}],
             "days":[{"date":"2026-10-14","selected":true,"recommendedRouteId":"\(route)","temperatureMaxC":14.4,"best":\(departure("2026-10-14T08:00:00.000Z", "2026-10-14T11:00:00.000Z", 85.6))},
                     {"date":"2026-10-15","selected":true,"recommendedRouteId":null,"best":null,"availabilityReason":"no_feasible_departure"},
                     {"date":"2026-10-16","selected":false,"recommendedRouteId":null,"best":null,
                      "availabilityReason":"partial_coverage","until":"2026-10-16T17:00:00.000Z"}]}
            """
        let response = try RideOnAPI.decoder.decode(RideBoardLoader.Recommendation.self, from: Data(json.utf8))
        let board = RideBoardLoader.board(from: response, routes: [route: .init(coordinates: [], cycleTravelURL: nil)],
                                          summaries: [.init(routeId: route, lastRiddenOn: "2026-09-29")])

        let pick = try XCTUnwrap(board.picks.first)
        XCTAssertEqual(board.picks.count, 1)
        XCTAssertEqual(pick.route.name, "Hilly Loop")
        XCTAssertEqual(pick.score, 86)
        XCTAssertEqual(pick.conditions.sky, .sunnySpells)
        XCTAssertEqual(pick.conditions.wind, .tailwind)
        XCTAssertNotNil(pick.lastRidden)

        XCTAssertEqual(board.days.map { $0.best?.score }, [86, nil]) // unselected day dropped
        XCTAssertEqual(board.forecast.count, 3)
        XCTAssertEqual(board.forecast.map(\.note), [nil, "No tracked route fits your hours", nil])
        XCTAssertEqual(board.forecast[0].temperatureMaxC, 14.4)
        XCTAssertEqual(board.forecast[2].forecastEnds, ISO8601DateFormatter().date(from: "2026-10-16T17:00:00Z"))
        XCTAssertEqual(board.window.duration, 2 * 86_400)
        XCTAssertEqual(board.unfit.first?.rideDuration, 425 * 60)
        XCTAssertEqual(board.unfit.first?.windowAllows, (10 * 60 + 45) * 60)

        let detail = try XCTUnwrap(board.details[pick.id])
        XCTAssertEqual(detail.departures.map(\.score), [86, 70])
        XCTAssertEqual(detail.notes.map(\.kind), [.temperature, .wind, .other])
        let first = try XCTUnwrap(detail.departures.first)
        XCTAssertEqual(first.hours.map(\.sky), [.sunny, .rain])
        XCTAssertEqual(first.wind, [.init(.tailwind, from: 0, to: 25), .init(.headwind, from: 25, to: 50)])
        XCTAssertEqual(first.factors.map(\.name), ["Rain", "Wind", "Temperature", "Sunshine", "Sky"])
    }

    func testPlanningWindowRoundTrips() throws {
        for hours in [RideWindow.Hours.daylight, .custom(leave: 7 * 60 + 30, back: 17 * 60)] {
            let data = try JSONEncoder().encode(RideBoardLoader.PlanningWindow(hours))
            XCTAssertEqual(try JSONDecoder().decode(RideBoardLoader.PlanningWindow.self, from: data).hours, hours)
        }
        XCTAssertEqual(String(decoding: try JSONEncoder().encode(RideBoardLoader.PlanningWindow(.custom(leave: 450, back: 1020))), as: UTF8.self)
            .contains("\"07:30\""), true)
    }

    func testDecodesPolyline6() {
        // Google's polyline example, read at six decimal places.
        let points = PolylineDecoder.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision: 6)
        XCTAssertEqual(points.count, 3)
        XCTAssertEqual(points[0].latitude, 3.85, accuracy: 1e-9)
        XCTAssertEqual(points[2].longitude, -12.6453, accuracy: 1e-9)
    }
}

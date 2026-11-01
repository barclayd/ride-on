import Networking
import XCTest
import Domain
@testable import Services

/// `GET /tracked-rides/{id}` → `TrackedRide`, from trimmed records (docs/ride-tracking-api.md).
final class RideTrackerTests: XCTestCase {
    let loop = "6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01"
    let ridge = "0b8f7a54-9e7b-4a3c-8f2e-5d6c7b8a9f02"

    func snapshot(score: Double, rain: String = "dry") -> String {
        """
        {"context":{"routes":[{"id":"\(loop)","name":"Hilly Loop"},{"id":"\(ridge)","name":"Ridge Run"}],"generatedAt":"2026-10-16T06:00:00.000Z"},
         "pick":{"routeId":"\(loop)","candidate":{"departureAt":"2026-10-17T08:00:00.000Z","finishAt":"2026-10-17T11:00:00.000Z",
           "score":\(score),"standards":{"status":"meets","failures":[]},"conditions":{"precipitationSummary":"\(rain)"}}}}
        """
    }

    func ride(latest: String?, comparison: String?, refresh: String, state: String = "active") throws -> TrackedRide {
        let json = """
            {"ride":{"id":"t1","routeId":"\(loop)","departureAt":"2026-10-17T08:00:00.000Z","finishAt":"2026-10-17T11:00:00.000Z",
              "timeZone":"Europe/London","createdAt":"2026-10-16T06:00:00.000Z","state":"\(state)","endedAt":null,"endedReason":null,"version":1,
              "baseline":\(snapshot(score: 84.6)),"latestAssessment":\(latest ?? "null"),"latestAssessmentKind":null,
              "comparison":\(comparison ?? "null"),"lastKnownComparison":null,"refresh":\(refresh),
              "capabilities":{"maximumActiveRides":1,"manualRefresh":true,"automaticChecks":false,"notifications":false}},
             "trackingVersion":3,"activeTrackedRideId":"t1"}
            """
        return RideTracker.trackedRide(try RideOnAPI.decoder.decode(RideTracker.Detail.self, from: Data(json.utf8)).ride)
    }

    func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    func refresh(_ result: String, reason: String? = nil, closed: Bool = false) -> String {
        """
        {"result":"\(result)","reasonCode":\(reason.map { "\"\($0)\"" } ?? "null"),"lastAttemptAt":"2026-10-16T09:00:00.000Z",
         "lastSuccessfulAssessmentAt":"2026-10-16T08:50:00.000Z","refreshAt":"2026-10-16T10:00:00.000Z",
         "assessmentFreshUntil":"2026-10-16T12:00:00.000Z","closed":\(closed)}
        """
    }

    func comparison(newlyFailing: String = "", coverage: String = "complete", route: Bool? = true, departure: Bool? = true,
                    bestRoute: String? = nil, bestAt: String = "2026-10-17T08:00:00.000Z") -> String {
        let flag = { (b: Bool?) in b.map(String.init) ?? "null" }
        return """
            {"scoreDeltaFromBaseline":-6.2,"significantScoreChange":true,
             "standards":{"status":"below","failures":[\(newlyFailing)],"newlyFailing":[\(newlyFailing)]},
             "bestPick":{"coverage":"\(coverage)","originallyRecommendedRoute":true,"routeStillRecommended":\(flag(route)),
               "departureStillRecommended":\(flag(departure)),"lostOriginalBestPick":false,
               "bestKnown":{"routeId":"\(bestRoute ?? loop)","departureAt":"\(bestAt)","score":80,"recommendationPriority":0}},
             "contextChanges":[]}
            """
    }

    func testUnchangedComparisonHasNoChanges() throws {
        let tracked = try ride(latest: snapshot(score: 84.9), comparison: comparison(), refresh: refresh("assessed"))
        XCTAssertEqual(tracked.originalScore, 85)
        XCTAssertEqual(tracked.latestScore, 85)
        guard case .checked(let at, let changes) = tracked.check else { return XCTFail("\(tracked.check)") }
        XCTAssertEqual(at, date("2026-10-16T08:50:00Z"))
        XCTAssertEqual(changes, [])
    }

    func testChangesComeMostImportantFirst() throws {
        let gust = #"{"standard":"maximumGustKph","limit":45,"actual":52,"at":"2026-10-17T09:00:00.000Z","unit":"km/h"}"#
        let tracked = try ride(latest: snapshot(score: 78.4, rain: "light_rain"),
                               comparison: comparison(newlyFailing: gust, route: false, departure: false, bestRoute: ridge, bestAt: "2026-10-17T09:30:00.000Z"),
                               refresh: refresh("assessed"))
        guard case .checked(_, let changes) = tracked.check else { return XCTFail("\(tracked.check)") }
        XCTAssertEqual(changes, [.standard(.gust, actual: 52, limit: 45), .rain,
                                 .betterRoute(name: "Ridge Run", start: date("2026-10-17T09:30:00Z")), .score(-7)])
    }

    func testRainStandardStandsInForRainAndIncompleteCoverageIsSaid() throws {
        let chance = #"{"standard":"maximumPrecipitationProbability","limit":0.6,"actual":0.8,"at":"2026-10-17T09:00:00.000Z"}"#
        let tracked = try ride(latest: snapshot(score: 84.6, rain: "showers"),
                               comparison: comparison(newlyFailing: chance, coverage: "incomplete", route: nil, departure: false),
                               refresh: refresh("assessed"))
        guard case .checked(_, let changes) = tracked.check else { return XCTFail("\(tracked.check)") }
        XCTAssertEqual(changes, [.standard(.rainChance, actual: 0.8, limit: 0.6), .betterTime(start: tracked.start), .incomplete])
    }

    func testFailedCheckNeverReadsAsUnchanged() throws {
        let tracked = try ride(latest: snapshot(score: 80), comparison: nil, refresh: refresh("unavailable", reason: "forecast_unavailable"))
        XCTAssertEqual(tracked.check, .failed(.forecastUnavailable, lastChecked: date("2026-10-16T08:50:00Z")))
        XCTAssertEqual(tracked.latestScore, 80)
    }

    func testStaleInProgressAndClosed() throws {
        XCTAssertEqual(try ride(latest: nil, comparison: nil, refresh: refresh("not_checked")).check, .due(lastChecked: date("2026-10-16T08:50:00Z")))
        XCTAssertEqual(try ride(latest: nil, comparison: nil, refresh: refresh("in_progress")).check, .checking)
        XCTAssertEqual(try ride(latest: snapshot(score: 84.6), comparison: comparison(), refresh: refresh("assessed", closed: true)).check, .closed)
    }

    func testCreateSendsNullReplacement() throws {
        let body = RideTracker.Create(recommendationRef: "r1", expectedTrackingVersion: 0, replaceTrackedRideId: nil)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any]
        XCTAssertEqual(json?.keys.sorted(), ["expectedTrackingVersion", "recommendationRef", "replaceTrackedRideId"])
        XCTAssertTrue(json?["replaceTrackedRideId"] is NSNull)
    }
}

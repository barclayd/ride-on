import Networking
import XCTest
import Domain
@testable import Services

/// `GET /routes` + `GET /rides` → `RouteLibrary`, and how a shortlist edit replays onto a newer list.
final class RouteLibraryLoaderTests: XCTestCase {
    private let hilly = UUID(uuidString: "6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01")!
    private let coast = UUID(uuidString: "0b8f7a54-9e7b-4a3c-8f2e-5d6c7b8a9f02")!
    private let gone = UUID(uuidString: "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e04")!

    func testMapsRoutesAndRidesOntoLibrary() throws {
        let routes = """
            {"routes":[
              {"id":"6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01","name":"Hilly Loop","createdAt":"2026-09-01T10:00:00.000Z",
               "distanceM":51200,"ascentM":640,"originalPointCount":812,"warnings":[],"geometryStatus":"available",
               "surfaceSummary":{"status":"complete","pavedM":46080,"unpavedM":5120,"nonCyclingM":0,"unknownM":0,
                 "classifiedFraction":1,"unpavedFraction":0.1,"source":"osm","capturedAt":"2026-09-01T10:00:05.000Z"},
               "source":{"providerId":"cycle-travel","externalId":"123456"},"version":3,"updatedAt":"2026-09-02T10:00:00.000Z"},
              {"id":"0b8f7a54-9e7b-4a3c-8f2e-5d6c7b8a9f02","name":"Coast Road","createdAt":"2026-08-01T10:00:00.000Z",
               "distanceM":30000,"ascentM":null,"originalPointCount":300,"warnings":[],"geometryStatus":"unavailable",
               "surfaceSummary":{"status":"pending","pavedM":0,"unpavedM":0,"nonCyclingM":0,"unknownM":30000,
                 "classifiedFraction":0,"unpavedFraction":null,"source":null,"capturedAt":null},
               "source":null,"version":1,"updatedAt":"2026-08-01T10:00:00.000Z"}
            ],"limit":100,"nextCursor":null}
            """
        let snapshot = """
            {"id":"6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01","name":"Hilly Loop (old)","version":2,"distanceM":50000,"ascentM":600}
            """
        let rides = """
            {"rides":[
              {"id":"ride-1","version":1,"routeId":"6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01","route":\(snapshot),
               "riddenOn":"2026-10-03","timeZone":"Europe/London","recordedAt":"2026-10-03T18:00:00.000Z","updatedAt":"2026-10-03T18:00:00.000Z",
               "plan":{"schemaVersion":1,"departureAt":"2026-10-03T08:00:00.000Z","finishAt":"2026-10-03T11:00:00.000Z",
                 "conditions":{"temperatureC":{"minimum":9,"maximum":14},"averageWindSpeedKph":15,"averageHeadwindKph":4,
                   "averageTailwindKph":6,"averageCrosswindKph":4,"maximumGustKph":28,"maximumPrecipitationProbability":0.05,
                   "distanceKm":50,"skyConditionDistanceFractions":{"sunny":0.8,"cloudy":0.2}},
                 "pickRank":1,"generatedAt":"2026-10-02T19:00:00.000Z","algorithmVersion":"2026-10-01","weather":{"attribution":[]}},
               "planSource":"recommendation","source":{"type":"manual"},"geometryBasis":"route","geometryStatus":"available"},
              {"id":"ride-2","version":1,"routeId":"3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e04",
               "route":{"id":"3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e04","name":"Deleted Loop","version":1,"distanceM":40000,"ascentM":null},
               "riddenOn":"2026-09-20","timeZone":"Europe/London","recordedAt":"2026-09-20T18:00:00.000Z","updatedAt":"2026-09-20T18:00:00.000Z",
               "plan":{"schemaVersion":99,"somethingNew":true},"planSource":"manual","source":{"type":"manual"},
               "geometryBasis":"route","geometryStatus":"unavailable"}
            ],"nextCursor":null,"summary":{"rideCount":2,"lastRiddenOn":"2026-10-03"},"historyRevision":"r1"}
            """
        let page = try RideOnAPI.decoder.decode(RouteLibraryLoader.RoutesResponse.self, from: Data(routes.utf8))
        let history = try RideOnAPI.decoder.decode(RouteLibraryLoader.RidesResponse.self, from: Data(rides.utf8))
        let path = [Coordinate(latitude: 51.5, longitude: -0.1), Coordinate(latitude: 51.6, longitude: -0.2)]

        let library = RouteLibraryLoader.library(routes: page.routes, geometry: [hilly.uuidString.lowercased(): path],
                                                 lastRidden: [hilly.uuidString.lowercased(): "2026-10-03"],
                                                 rides: history.rides, shortlist: [hilly])

        XCTAssertEqual(library.shortlist, [hilly])
        XCTAssertEqual(library.shortlistLimit, 12)
        XCTAssertEqual(library.routes.map(\.id), [hilly, coast])
        let route = library.routes[0]
        XCTAssertEqual(route.name, "Hilly Loop")
        XCTAssertEqual(route.distanceKm, 51.2, accuracy: 0.001)
        XCTAssertEqual(route.ascentM, 640)
        XCTAssertEqual(route.unpaved, 0.1)
        XCTAssertEqual(route.source, .cycleTravel)
        XCTAssertEqual(route.coordinates, path)
        XCTAssertEqual(route.lastRidden, Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 3)))
        let plain = library.routes[1]
        XCTAssertEqual(plain.ascentM, 0)
        XCTAssertNil(plain.unpaved)
        XCTAssertEqual(plain.source, .gpxFile)
        XCTAssertEqual(plain.coordinates, [])
        XCTAssertNil(plain.lastRidden)

        XCTAssertEqual(library.rides.map(\.id), ["ride-1", "ride-2"])
        let ride = library.rides[0]
        // Named as ridden, drawn as saved.
        XCTAssertEqual(ride.route.name, "Hilly Loop (old)")
        XCTAssertEqual(ride.route.distanceKm, 50)
        XCTAssertEqual(ride.route.coordinates, path)
        XCTAssertEqual(ride.route.source, .cycleTravel)
        XCTAssertEqual(ride.riddenOn, Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 3)))
        let plan = try XCTUnwrap(ride.plan)
        XCTAssertEqual(plan.start, try Date("2026-10-03T08:00:00Z", strategy: .iso8601))
        XCTAssertEqual(plan.temperatureC, 12)
        XCTAssertEqual(plan.windKph, 15)
        XCTAssertEqual(plan.sky, .sunny)
        // A deleted route's ride stays in History; a plan the app can't read shows no forecast.
        let orphan = library.rides[1]
        XCTAssertEqual(orphan.route.id, gone)
        XCTAssertEqual(orphan.route.name, "Deleted Loop")
        XCTAssertEqual(orphan.route.source, .gpxFile)
        XCTAssertNil(orphan.plan)
    }

    func testSourcesMapToProviders() {
        typealias Source = RouteLibraryLoader.RouteSummary.Source
        XCTAssertEqual(RouteLibraryLoader.source(Source(providerId: "cycle-travel")), .cycleTravel)
        XCTAssertEqual(RouteLibraryLoader.source(Source(providerId: "strava")), .strava)
        XCTAssertEqual(RouteLibraryLoader.source(Source(providerId: "garmin")), .garmin)
        XCTAssertEqual(RouteLibraryLoader.source(Source(providerId: "komoot")), .gpxFile)
        XCTAssertEqual(RouteLibraryLoader.source(nil), .gpxFile)
    }

    func testMergeReplaysAdditionsAndRemovalsOntoNewerShortlist() {
        let ids = (0..<5).map { _ in UUID() }
        // This device removed 1 and added 3; elsewhere 4 was added and 0 removed.
        let merged = RouteLibraryLoader.merge([ids[0], ids[2], ids[3]], base: [ids[0], ids[1], ids[2]], onto: [ids[1], ids[2], ids[4]])
        XCTAssertEqual(merged, [ids[2], ids[4], ids[3]])
    }

    func testMergeSkipsAdditionsAlreadyThereAndCapsAtLimit() {
        let current = (0..<12).map { _ in UUID() }
        let added = UUID()
        XCTAssertEqual(RouteLibraryLoader.merge([current[0], added], base: [current[0]], onto: current), current)
        XCTAssertEqual(RouteLibraryLoader.merge([current[0], current[5]], base: [current[0]], onto: current), current)
        XCTAssertEqual(RouteLibraryLoader.merge([], base: [], onto: []), [])
    }
}

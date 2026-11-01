import XCTest
import SwiftData
import Domain
import Models

/// A real SQLite store written before extraction; never reads personal app data.
@MainActor
final class LegacyStoreCompatibilityTests: XCTestCase {
    func testLegacyStore() throws {
        guard let path = ProcessInfo.processInfo.environment["RIDEON_COMPATIBILITY_STORE"] else {
            throw XCTSkip("Run apple/scripts/check-legacy-store.sh to create the baseline fixture")
        }
        let schema = Schema([RouteModel.self, RideLogModel.self, SavedPlaceModel.self])
        let configuration = ModelConfiguration(schema: schema, url: URL(filePath: path), cloudKitDatabase: .none)
        let container = try ModelContainer(for: schema, configurations: [configuration])
        let context = ModelContext(container)
        let routeID = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        let logID = UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
        let placeID = UUID(uuidString: "00000000-0000-0000-0000-000000000003")!
        if ProcessInfo.processInfo.environment["RIDEON_WRITE_COMPATIBILITY_STORE"] == "1" {
            context.insert(RouteModel(id: routeID, name: "Compatibility Loop", notes: "Unsent classification retry", distanceKm: 12.5, elevationGainM: 88,
                coordinates: [Coordinate(latitude: 51.75, longitude: -0.8), Coordinate(latitude: 51.76, longitude: -0.79)],
                elevations: [100, nil], surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 10, .unpaved: 2.5]),
                suggestedType: .gravel, userOverriddenType: .road, needsClassification: true,
                bearingSegments: [BearingSegment(bearingDegrees: 45, lengthKm: 1)],
                createdAt: Date(timeIntervalSince1970: 1700000000), source: .strava, stravaRouteID: "synthetic-route", importedFrom: "Fixture"))
            context.insert(RideLogModel(id: logID, date: Date(timeIntervalSince1970: 1700000060), routeID: routeID, source: .strava, stravaActivityID: "synthetic-activity"))
            context.insert(SavedPlaceModel(id: placeID, name: "Fixture Home", coordinate: Coordinate(latitude: 51.5, longitude: -0.12)))
            try context.save()
        }
        let routes = try context.fetch(FetchDescriptor<RouteModel>())
        XCTAssertEqual(routes.count, 1)
        let route = try XCTUnwrap(routes.first)
        XCTAssertEqual(route.id, routeID)
        XCTAssertEqual(route.name, "Compatibility Loop")
        XCTAssertEqual(route.notes, "Unsent classification retry")
        XCTAssertEqual(route.distanceKm, 12.5)
        XCTAssertEqual(route.elevationGainM, 88)
        XCTAssertEqual(route.coordinates, [Coordinate(latitude: 51.75, longitude: -0.8), Coordinate(latitude: 51.76, longitude: -0.79)])
        XCTAssertEqual(route.elevations, [100, nil])
        XCTAssertEqual(route.surfaces?.distanceKmBySurface[.paved], 10)
        XCTAssertEqual(route.surfaces?.distanceKmBySurface[.unpaved], 2.5)
        XCTAssertEqual(route.suggestedType, .gravel)
        XCTAssertEqual(route.userOverriddenType, .road)
        XCTAssertTrue(route.needsClassification)
        XCTAssertEqual(route.bearingSegments, [BearingSegment(bearingDegrees: 45, lengthKm: 1)])
        XCTAssertEqual(route.createdAt, Date(timeIntervalSince1970: 1700000000))
        XCTAssertEqual(route.source, .strava)
        XCTAssertEqual(route.stravaRouteID, "synthetic-route")
        XCTAssertEqual(route.importedFrom, "Fixture")
        let logs = try context.fetch(FetchDescriptor<RideLogModel>())
        XCTAssertEqual(logs.count, 1)
        let log = try XCTUnwrap(logs.first)
        XCTAssertEqual(log.id, logID)
        XCTAssertEqual(log.routeID, routeID)
        XCTAssertEqual(log.date, Date(timeIntervalSince1970: 1700000060))
        XCTAssertEqual(log.source, .strava)
        XCTAssertEqual(log.stravaActivityID, "synthetic-activity")
        let places = try context.fetch(FetchDescriptor<SavedPlaceModel>())
        XCTAssertEqual(places.count, 1)
        let place = try XCTUnwrap(places.first)
        XCTAssertEqual(place.id, placeID)
        XCTAssertEqual(place.name, "Fixture Home")
        XCTAssertEqual(place.coordinate, Coordinate(latitude: 51.5, longitude: -0.12))
        XCTAssertTrue(String(reflecting: RouteModel.self).hasPrefix("Models."))
    }
}

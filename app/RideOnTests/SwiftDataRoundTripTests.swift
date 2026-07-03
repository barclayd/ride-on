import XCTest
import SwiftData
import RideOnCore
@testable import RideOn

/// Insert -> fetch for each `@Model`, proving the packed/JSON-encoded
/// computed properties survive a real SwiftData context round trip (not
/// just in-memory struct equality).
@MainActor
final class SwiftDataRoundTripTests: XCTestCase {
    func testRouteModelRoundTrip() throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)

        let coordinates = [Coordinate(latitude: 51.75, longitude: -0.8), Coordinate(latitude: 51.76, longitude: -0.79)]
        let original = RouteModel(
            name: "Round Trip Route",
            distanceKm: 12.5,
            elevationGainM: 88,
            coordinates: coordinates,
            elevations: [100, nil],
            surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 10, .unpaved: 2.5]),
            suggestedType: .gravel,
            bearingSegments: [BearingSegment(bearingDegrees: 45, lengthKm: 1)]
        )
        context.insert(original)
        try context.save()

        let fetched = try XCTUnwrap(try context.fetch(FetchDescriptor<RouteModel>()).first)
        XCTAssertEqual(fetched.name, "Round Trip Route")
        XCTAssertEqual(fetched.distanceKm, 12.5)
        XCTAssertEqual(fetched.coordinates.count, 2)
        XCTAssertEqual(fetched.coordinates.first?.latitude ?? 0, 51.75, accuracy: 0.0001)
        XCTAssertEqual(fetched.elevations, [100, nil])
        XCTAssertEqual(fetched.surfaces?.distanceKmBySurface[.paved], 10)
        XCTAssertEqual(fetched.suggestedType, .gravel)
        XCTAssertEqual(fetched.bearingSegments.count, 1)
    }

    func testRideLogModelRoundTrip() throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)

        let routeID = UUID()
        let original = RideLogModel(date: .now, routeID: routeID, source: .strava)
        context.insert(original)
        try context.save()

        let fetched = try XCTUnwrap(try context.fetch(FetchDescriptor<RideLogModel>()).first)
        XCTAssertEqual(fetched.routeID, routeID)
        XCTAssertEqual(fetched.source, .strava)
    }

    func testSavedPlaceModelRoundTrip() throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)

        let original = SavedPlaceModel(name: "Home", coordinate: Coordinate(latitude: 51.5, longitude: -0.12))
        context.insert(original)
        try context.save()

        let fetched = try XCTUnwrap(try context.fetch(FetchDescriptor<SavedPlaceModel>()).first)
        XCTAssertEqual(fetched.name, "Home")
        XCTAssertEqual(fetched.coordinate.latitude, 51.5, accuracy: 0.0001)
    }
}

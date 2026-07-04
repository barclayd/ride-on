import XCTest
import Models
@testable import Services

final class ElevationServiceTests: XCTestCase {
    func testURLEncodesCommaJoinedCoordinates() {
        let url = LiveOpenMeteoElevationClient.url(for: [
            Coordinate(latitude: 51.06684, longitude: -1.31963),
            Coordinate(latitude: 50.9101, longitude: -0.5471),
        ])
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        XCTAssertEqual(components.host, "api.open-meteo.com")
        XCTAssertEqual(components.path, "/v1/elevation")
        XCTAssertEqual(
            components.queryItems?.first { $0.name == "latitude" }?.value,
            "51.06684,50.91010"
        )
        XCTAssertEqual(
            components.queryItems?.first { $0.name == "longitude" }?.value,
            "-1.31963,-0.54710"
        )
    }

    func testSampleIndicesPassthroughUnderCap() {
        XCTAssertEqual(RouteImporter.sampleIndices(count: 3, cap: 10), [0, 1, 2])
    }

    func testSampleIndicesCapsAndCoversEndpoints() {
        let indices = RouteImporter.sampleIndices(count: 10_000, cap: 2000)
        XCTAssertEqual(indices.count, 2000)
        XCTAssertEqual(indices.first, 0)
        XCTAssertEqual(indices.last, 9999)
        XCTAssertEqual(indices, indices.sorted())
    }

    func testFixtureElevationClientAlignsWithInput() async throws {
        let coords = (0..<7).map { Coordinate(latitude: 51.0 + Double($0) * 0.001, longitude: -1.0) }
        let elevations = try await FixtureElevationClient().elevations(coordinates: coords)
        XCTAssertEqual(elevations.count, 7)
        XCTAssertFalse(elevations.contains(nil))
    }
}

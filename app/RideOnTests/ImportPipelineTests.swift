import XCTest
import SwiftData
import Models
import Services

/// GPX Data -> RouteImporter -> persisted RouteModel, against fixture
/// ClassifyClient. Covers both the classify-success and classify-failure
/// (non-fatal, needsClassification) paths per Phase 2 spec.
@MainActor
final class ImportPipelineTests: XCTestCase {
    private let sampleGPX = """
    <?xml version="1.0" encoding="UTF-8"?>
    <gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
      <trk>
        <name>Test Loop</name>
        <trkseg>
          <trkpt lat="51.7000" lon="-0.9000"><ele>100</ele></trkpt>
          <trkpt lat="51.7010" lon="-0.8985"><ele>105</ele></trkpt>
          <trkpt lat="51.7020" lon="-0.8970"><ele>110</ele></trkpt>
        </trkseg>
      </trk>
    </gpx>
    """.data(using: .utf8)!

    func testImportSuccessPersistsRouteWithSurfaces() async throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)
        let importer = RouteImporter(classifyClient: FixtureClassifyClient(), elevationClient: FixtureElevationClient(), modelContext: context)

        let model = try await importer.importGPX(data: sampleGPX)

        XCTAssertEqual(model.name, "Test Loop")
        XCTAssertGreaterThan(model.distanceKm, 0)
        XCTAssertFalse(model.needsClassification)
        XCTAssertEqual(model.suggestedType, .gravel)
        XCTAssertNotNil(model.surfaces)

        let fetched = try context.fetch(FetchDescriptor<RouteModel>())
        XCTAssertEqual(fetched.count, 1)
        XCTAssertEqual(fetched.first?.id, model.id)
    }

    func testImportClassifyFailureIsNonFatal() async throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)
        let importer = RouteImporter(
            classifyClient: FixtureClassifyClient(shouldFail: true),
            elevationClient: FixtureElevationClient(),
            modelContext: context
        )

        let model = try await importer.importGPX(data: sampleGPX)

        // Import still succeeds — parse failure is fatal, classify failure isn't.
        XCTAssertGreaterThan(model.distanceKm, 0)
        XCTAssertTrue(model.needsClassification)
        XCTAssertNil(model.suggestedType)
        XCTAssertNil(model.surfaces)

        let fetched = try context.fetch(FetchDescriptor<RouteModel>())
        XCTAssertEqual(fetched.count, 1)
    }

    func testImportFillsMissingElevationsFromElevationClient() async throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)
        let importer = RouteImporter(classifyClient: FixtureClassifyClient(), elevationClient: FixtureElevationClient(), modelContext: context)

        // No <ele> anywhere — the cycle.travel export shape.
        let eleLess = """
        <?xml version="1.0"?>
        <gpx version="1.0" creator="cycle.travel" xmlns="http://www.topografix.com/GPX/1/0">
          <trk><name>Flat File</name><trkseg>
            <trkpt lat="51.7000" lon="-0.9000" />
            <trkpt lat="51.7010" lon="-0.8985" />
            <trkpt lat="51.7020" lon="-0.8970" />
          </trkseg></trk>
        </gpx>
        """.data(using: .utf8)!

        let model = try await importer.importGPX(data: eleLess)

        XCTAssertEqual(model.elevations.count, 3)
        XCTAssertFalse(model.elevations.contains(nil))
    }

    func testImportElevationFetchFailureIsNonFatal() async throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)
        let importer = RouteImporter(
            classifyClient: FixtureClassifyClient(),
            elevationClient: FixtureElevationClient(shouldFail: true),
            modelContext: context
        )

        let eleLess = """
        <?xml version="1.0"?>
        <gpx version="1.0" creator="cycle.travel" xmlns="http://www.topografix.com/GPX/1/0">
          <trk><trkseg>
            <trkpt lat="51.7000" lon="-0.9000" />
            <trkpt lat="51.7010" lon="-0.8985" />
          </trkseg></trk>
        </gpx>
        """.data(using: .utf8)!

        let model = try await importer.importGPX(data: eleLess)

        // Route still imports with zero gain, matching the classify policy.
        XCTAssertEqual(model.elevationGainM, 0)
        XCTAssertGreaterThan(model.distanceKm, 0)
    }

    func testImportMalformedGPXThrows() async throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)
        let importer = RouteImporter(classifyClient: FixtureClassifyClient(), elevationClient: FixtureElevationClient(), modelContext: context)

        let garbage = "not xml at all".data(using: .utf8)!
        do {
            _ = try await importer.importGPX(data: garbage)
            XCTFail("Expected a parse error")
        } catch {
            // Parse failure is fatal and thrown, per RouteImporter's contract.
        }
    }
}

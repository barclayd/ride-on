import XCTest
import SwiftData
import RideOnCore
@testable import RideOn

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
        let importer = RouteImporter(classifyClient: FixtureClassifyClient(), modelContext: context)

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

    func testImportMalformedGPXThrows() async throws {
        let container = RideOnModelContainer.inMemory()
        let context = ModelContext(container)
        let importer = RouteImporter(classifyClient: FixtureClassifyClient(), modelContext: context)

        let garbage = "not xml at all".data(using: .utf8)!
        do {
            _ = try await importer.importGPX(data: garbage)
            XCTFail("Expected a parse error")
        } catch {
            // Parse failure is fatal and thrown, per RouteImporter's contract.
        }
    }
}

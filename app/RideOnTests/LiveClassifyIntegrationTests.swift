import XCTest
import RideOnCore
@testable import RideOn

/// Hits the DEPLOYED worker (not local code) — mirrors worker/test/smoke.test.ts's
/// pattern. Skipped entirely unless RUN_LIVE_CLASSIFY_TEST=1 is set, so this
/// never runs as part of `xcodebuild test` / CI by default.
///
/// ponytail: `xcodebuild test` on an iOS Simulator destination doesn't
/// forward the invoking shell's environment to the test host process
/// (testmanagerd launches it in the simulator's own process tree) — plain
/// `RUN_LIVE_CLASSIFY_TEST=1 xcodebuild ... test` will NOT flip this on.
/// This is a "run once manually, read the result" check per spec, not a
/// CI-wired toggle, so the practical way to trigger it is Xcode's Product >
/// Test with RUN_LIVE_CLASSIFY_TEST=1 added to the scheme's Test action
/// environment variables (Edit Scheme > Test > Arguments), or by
/// temporarily hardcoding `true` here for a single local run.
final class LiveClassifyIntegrationTests: XCTestCase {
    func testLiveClassifyRespondsForSampleRoute() async throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RUN_LIVE_CLASSIFY_TEST"] == "1",
            "Set RUN_LIVE_CLASSIFY_TEST=1 in the scheme's Test action environment to hit the live worker."
        )

        // Same coordinates as RideOnCore's sample-route.gpx fixture.
        let coordinates = [
            Coordinate(latitude: 51.7520, longitude: -0.8010),
            Coordinate(latitude: 51.7524, longitude: -0.7995),
            Coordinate(latitude: 51.7529, longitude: -0.7978),
            Coordinate(latitude: 51.7535, longitude: -0.7960),
            Coordinate(latitude: 51.7541, longitude: -0.7942),
            Coordinate(latitude: 51.7548, longitude: -0.7924),
            Coordinate(latitude: 51.7554, longitude: -0.7906),
            Coordinate(latitude: 51.7561, longitude: -0.7888),
            Coordinate(latitude: 51.7567, longitude: -0.7870),
            Coordinate(latitude: 51.7572, longitude: -0.7851),
        ]

        let result = try await LiveClassifyClient().classify(coordinates: coordinates)

        XCTAssertGreaterThan(result.lengthKm, 0)
        print("LIVE /classify result: suggestedType=\(result.suggestedType) lengthKm=\(result.lengthKm) surfaces=\(result.surfaces.distanceKmBySurface)")
    }
}

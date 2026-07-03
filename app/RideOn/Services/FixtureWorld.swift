import Foundation
import SwiftData
import RideOnCore

/// Deterministic "fixture world" for E2E tests and previews: launch with
/// `--fixture-world` and every service below returns canned, seeded data —
/// no live network, no location permission prompts, no real weather.
enum FixtureWorld {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains("--fixture-world")
    }

    static let sampleRoute = Route(
        name: "Chilterns Loop",
        distanceKm: 42,
        elevationGainM: 380,
        surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 30, .unpaved: 12]),
        suggestedBikeType: .gravel
    )

    static let sampleLocation = Coordinate(latitude: 51.7520, longitude: -0.8010)

    /// Seeds the (in-memory, fixture-world) SwiftData store with one
    /// imported-looking route, so the Routes tab has something deterministic
    /// to show in E2E tests without driving the file-picker UI (flaky —
    /// see RideOnUITests).
    @MainActor
    static func seed(into context: ModelContext) {
        context.insert(sampleRoute.asModel(source: .gpxImport))
    }
}

struct FixtureWeatherProvider: WeatherProviding {
    func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot {
        WeatherSnapshot(temperatureC: 18, sky: .sunny, windKph: 12, rainChance: 0.1)
    }
}

struct FixtureETAProvider: ETAProviding {
    func travelTime(from: Coordinate, to: Coordinate) async throws -> TimeInterval {
        15 * 60
    }
}

struct FixtureHealthStore: HealthStoreProviding {
    func recentCyclingRides(since: Date) async throws -> [RideLog] {
        []
    }
}

struct FixtureStravaClient: StravaClientProtocol {
    func exchangeToken(code: String) async throws -> String {
        "fixture-token"
    }

    func importedRoutes() async throws -> [Route] {
        [FixtureWorld.sampleRoute]
    }
}

/// Fixture `/classify` fake — canned success by default, or `shouldFail` to
/// exercise the import pipeline's non-fatal "needsClassification" path
/// without touching the network.
struct FixtureClassifyClient: ClassifyClient {
    var result: ClassifyResult = ClassifyResult(
        surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 30, .unpaved: 12]),
        suggestedType: .gravel,
        lengthKm: 42
    )
    var shouldFail = false

    func classify(coordinates: [Coordinate]) async throws -> ClassifyResult {
        if shouldFail {
            throw ClassifyClientError.requestFailed(status: 503)
        }
        return result
    }
}

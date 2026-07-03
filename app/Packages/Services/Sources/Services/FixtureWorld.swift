import Foundation
import SwiftData
import Models

/// Deterministic "fixture world" for E2E tests and previews: launch with
/// `--fixture-world` and every service below returns canned, seeded data —
/// no live network, no location permission prompts, no real weather.
public enum FixtureWorld {
    public static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains("--fixture-world")
    }

    public static let sampleRoute = Route(
        name: "Chilterns Loop",
        distanceKm: 42,
        elevationGainM: 380,
        surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 30, .unpaved: 12]),
        suggestedBikeType: .gravel
    )

    public static let sampleLocation = Coordinate(latitude: 51.7520, longitude: -0.8010)

    /// Seeds the (in-memory, fixture-world) SwiftData store with one
    /// imported-looking route, so the Routes tab has something deterministic
    /// to show in E2E tests without driving the file-picker UI (flaky —
    /// see RideOnUITests).
    @MainActor
    public static func seed(into context: ModelContext) {
        context.insert(sampleRoute.asModel(source: .gpxImport))
    }
}

public struct FixtureWeatherProvider: WeatherProviding {
    public init() {}

    public func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot {
        WeatherSnapshot(temperatureC: 18, sky: .sunny, windKph: 12, rainChance: 0.1)
    }
}

public struct FixtureETAProvider: ETAProviding {
    public init() {}

    public func travelTime(from: Coordinate, to: Coordinate) async throws -> TimeInterval {
        15 * 60
    }
}

public struct FixtureHealthStore: HealthStoreProviding {
    public init() {}

    public func recentCyclingRides(since: Date) async throws -> [RideLog] {
        []
    }
}

public struct FixtureStravaClient: StravaClientProtocol {
    public init() {}

    public func exchangeToken(code: String) async throws -> String {
        "fixture-token"
    }

    public func importedRoutes() async throws -> [Route] {
        [FixtureWorld.sampleRoute]
    }
}

/// Fixture `/classify` fake — canned success by default, or `shouldFail` to
/// exercise the import pipeline's non-fatal "needsClassification" path
/// without touching the network.
public struct FixtureClassifyClient: ClassifyClient {
    public var result: ClassifyResult
    public var shouldFail: Bool

    public init(
        result: ClassifyResult = ClassifyResult(
            surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 30, .unpaved: 12]),
            suggestedType: .gravel,
            lengthKm: 42
        ),
        shouldFail: Bool = false
    ) {
        self.result = result
        self.shouldFail = shouldFail
    }

    public func classify(coordinates: [Coordinate]) async throws -> ClassifyResult {
        if shouldFail {
            throw ClassifyClientError.requestFailed(status: 503)
        }
        return result
    }
}

import Foundation
import SwiftData
import Models
import Engine
import DesignSystem

/// Deterministic "fixture world" for E2E tests and previews: launch with
/// `--fixture-world` and every service below returns canned, seeded data —
/// no live network, no location permission prompts, no real weather.
public enum FixtureWorld {
    public static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains("--fixture-world")
    }

    // ponytail: real lat/lon loops (via `Engine.GPXGeometry`, reached through
    // the public `GPXTrack.bearingSegments()`) generated procedurally instead
    // of hand-typed coordinate lists — gives the map hero, elevation chart,
    // and wind factor real geometry to work with without a fixtures/*.gpx
    // file. `distanceKm`/`elevationGainM` on the `Route` below are set
    // explicitly rather than read off the generated track, so existing
    // fixture-world assertions ("42.0 km") keep holding regardless of the
    // loop's actual generated length.
    private static let chilternsTrack = loopTrack(centerLat: 51.7520, centerLon: -0.8010, radiusKm: 3.2, points: 28, baseElevationM: 110, climbM: 90)
    private static let ridgewayTrack = loopTrack(centerLat: 51.6800, centerLon: -1.2000, radiusKm: 5.4, points: 32, baseElevationM: 140, climbM: 160)
    private static let townTrack = loopTrack(centerLat: 51.7520, centerLon: -0.8010, radiusKm: 1.1, points: 16, baseElevationM: 70, climbM: 20)

    public static let sampleRoute = Route(
        name: "Chilterns Loop",
        distanceKm: 42,
        elevationGainM: 380,
        surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 30, .unpaved: 12]),
        suggestedBikeType: .gravel,
        start: chilternsTrack.coordinates.first,
        end: chilternsTrack.coordinates.last,
        coordinates: chilternsTrack.coordinates,
        bearingSegments: chilternsTrack.bearingSegments()
    )

    public static let ridgewayRoute = Route(
        name: "Ridgeway Gravel",
        distanceKm: 61,
        elevationGainM: 640,
        surfaces: SurfaceBreakdown(distanceKmBySurface: [.unpaved: 45, .path: 16]),
        suggestedBikeType: .gravel,
        start: ridgewayTrack.coordinates.first,
        end: ridgewayTrack.coordinates.last,
        coordinates: ridgewayTrack.coordinates,
        bearingSegments: ridgewayTrack.bearingSegments()
    )

    public static let townRoute = Route(
        name: "Town Loop",
        distanceKm: 14,
        elevationGainM: 60,
        surfaces: SurfaceBreakdown(distanceKmBySurface: [.paved: 14]),
        suggestedBikeType: .road,
        start: townTrack.coordinates.first,
        end: townTrack.coordinates.last,
        coordinates: townTrack.coordinates,
        bearingSegments: townTrack.bearingSegments()
    )

    public static let sampleRoutes: [Route] = [sampleRoute, ridgewayRoute, townRoute]

    public static let sampleLocation = Coordinate(latitude: 51.7520, longitude: -0.8010)

    /// Seeds the (in-memory, fixture-world) SwiftData store with three
    /// imported-looking routes, a ride log, and a saved place, so Today/
    /// Routes/You all have something deterministic to show in E2E tests
    /// without driving the file-picker UI (flaky — see RideOnUITests).
    @MainActor
    public static func seed(into context: ModelContext) {
        context.insert(sampleRoute.asModel(source: .gpxImport, elevations: chilternsTrack.points.map(\.elevationM)))
        context.insert(ridgewayRoute.asModel(source: .gpxImport, elevations: ridgewayTrack.points.map(\.elevationM)))
        context.insert(townRoute.asModel(source: .strava, elevations: townTrack.points.map(\.elevationM)))

        // A recent-ish ride on the Town Loop so the novelty factor and route
        // detail's ride history both have something real to show.
        context.insert(RideLogModel(date: Date.now.addingTimeInterval(-3 * 86400), routeID: townRoute.id, source: .manual))

        context.insert(SavedPlaceModel(name: "Home", coordinate: sampleLocation))
    }

    private static func loopTrack(centerLat: Double, centerLon: Double, radiusKm: Double, points: Int, baseElevationM: Double, climbM: Double) -> GPXTrack {
        let earthRadiusKm = 6371.0
        var trackPoints: [GPXTrackPoint] = []
        for index in 0..<points {
            let angle = 2 * Double.pi * Double(index) / Double(points)
            let dLat = (radiusKm / earthRadiusKm) * cos(angle) * 180 / .pi
            let dLon = (radiusKm / earthRadiusKm) * sin(angle) / cos(centerLat * .pi / 180) * 180 / .pi
            let progress = Double(index) / Double(points)
            // One climb and one descent per loop, so the elevation chart has
            // a real shape rather than a flat line.
            let elevation = baseElevationM + climbM * sin(progress * .pi * 2)
            trackPoints.append(
                GPXTrackPoint(coordinate: Coordinate(latitude: centerLat + dLat, longitude: centerLon + dLon), elevationM: elevation)
            )
        }
        return GPXTrack(points: trackPoints)
    }
}

public struct FixtureWeatherProvider: WeatherProviding {
    public init() {}

    /// Deterministic 10-day table keyed by day offset from today, mimicking
    /// the live provider's confidence bound (out-of-range dates throw).
    /// Day 0 keeps the original fixture values so existing ranking
    /// assertions hold; day 2 is deliberately the standout so the best-day
    /// scan lands on a stable non-today answer in E2E.
    private static let days: [(temperatureC: Double, sky: SkyCondition, windKph: Double, rainChance: Double)] = [
        (18, .sunny, 12, 0.1),
        (16, .overcast, 20, 0.3),
        (19, .sunny, 5, 0.0),
        (14, .rain, 25, 0.8),
        (13, .rain, 30, 0.9),
        (15, .overcast, 18, 0.4),
        (17, .sunny, 14, 0.2),
        (12, .overcast, 22, 0.5),
        (11, .rain, 28, 0.7),
        (16, .overcast, 16, 0.3),
    ]

    public func forecast(for location: Coordinate, on date: Date) async throws -> WeatherSnapshot {
        let calendar = Calendar.current
        let offset = calendar.dateComponents([.day], from: calendar.startOfDay(for: .now), to: calendar.startOfDay(for: date)).day ?? 0
        guard Self.days.indices.contains(offset) else { throw WeatherProvidingError.noForecast }
        let day = Self.days[offset]
        return WeatherSnapshot(temperatureC: day.temperatureC, sky: day.sky, windKph: day.windKph, rainChance: day.rainChance)
    }
}

public struct FixtureLocationProvider: LocationProviding {
    public init() {}

    public func currentLocation(requestingPermissionIfNeeded: Bool) async -> Coordinate? {
        FixtureWorld.sampleLocation
    }
}

public struct FixtureETAProvider: ETAProviding {
    public init() {}

    public func travelTime(from: Coordinate, to: Coordinate, mode: TravelMode) async throws -> TimeInterval {
        15 * 60
    }
}

public struct FixtureHealthStore: HealthStoreProviding {
    public init() {}

    public func recentCyclingRides(since: Date, matchingAgainst routes: [Route]) async throws -> [RideLog] {
        []
    }
}

/// Deterministic Strava fake: an actor (not a struct) since it has to track
/// "connected" state across calls the same way the real token-backed live
/// client does — a plain struct's state wouldn't survive between calls on
/// the shared `AppServices.fixtures` instance.
public actor FixtureStravaClient: StravaClientProtocol {
    private var connectedFlag = false

    public init() {}

    public func isConnected() async -> Bool { connectedFlag }

    public func exchangeToken(code: String) async throws {
        connectedFlag = true
    }

    public func disconnect() async {
        connectedFlag = false
    }

    public func importedRoutes() async throws -> [Route] {
        [FixtureWorld.sampleRoute]
    }

    public func listRoutes() async throws -> [StravaRoute] {
        [StravaRoute(id: "fixture-route-1", name: FixtureWorld.sampleRoute.name, distanceKm: FixtureWorld.sampleRoute.distanceKm)]
    }

    public func exportRouteGPX(routeID: String) async throws -> Data {
        GPXWriter.data(name: "Fixture Strava Route", coordinates: FixtureWorld.sampleRoute.coordinates)
    }

    public func recentActivities(monthsAgo: Int) async throws -> [StravaActivity] {
        [StravaActivity(
            id: "fixture-activity-1",
            name: "Morning Ride",
            startDate: Date.now.addingTimeInterval(-3 * 86400),
            distanceKm: FixtureWorld.townRoute.distanceKm,
            movingTimeSeconds: 3600,
            coordinates: FixtureWorld.townRoute.coordinates
        )]
    }

    public nonisolated func activityWebURL(activityID: String) -> URL {
        URL(string: "https://www.strava.com/activities/\(activityID)")!
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

/// Deterministic rolling-hills profile so imports without `<ele>` still get
/// a believable non-zero gain in fixture/E2E runs — no network.
public struct FixtureElevationClient: ElevationClient {
    public var shouldFail: Bool

    public init(shouldFail: Bool = false) {
        self.shouldFail = shouldFail
    }

    public func elevations(coordinates: [Coordinate]) async throws -> [Double?] {
        if shouldFail {
            throw ElevationClientError.requestFailed(status: 503)
        }
        return coordinates.indices.map { 100 + 40 * sin(Double($0) / 8) }
    }
}

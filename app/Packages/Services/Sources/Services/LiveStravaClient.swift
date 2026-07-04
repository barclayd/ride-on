import Foundation
import Models
import Engine

/// Talks to Strava's API v3 directly for route/activity data (using the
/// access token from `StravaTokenManager`) and to our worker only for the
/// token exchange/refresh that needs the client secret (worker/CLAUDE.md).
/// PLAN.md's 7-day raw-data cache limit needs no active enforcement here:
/// nothing raw is ever persisted — routes become GPX imports
/// (`StravaRouteSyncService`) and activities become `RideLogModel` rows +
/// derived speed aggregates (`StravaActivitySyncService`), both "our data"
/// the moment they're written.
public final class LiveStravaClient: StravaClientProtocol, Sendable {
    private let tokenManager: StravaTokenManager
    private let urlSession: URLSession
    private let apiBaseURL = URL(string: "https://www.strava.com/api/v3")!

    public init(
        tokenManager: StravaTokenManager = StravaTokenManager(transport: LiveStravaTokenTransport()),
        urlSession: URLSession = .shared
    ) {
        self.tokenManager = tokenManager
        self.urlSession = urlSession
    }

    public func isConnected() async -> Bool {
        await tokenManager.isConnected
    }

    public func exchangeToken(code: String) async throws {
        try await tokenManager.completeAuthorization(code: code)
    }

    public func disconnect() async {
        await tokenManager.disconnect()
    }

    public func importedRoutes() async throws -> [Route] {
        let routes = try await listRoutes()
        guard let first = routes.first else { return [] }
        let data = try await exportRouteGPX(routeID: first.id)
        let track = try GPXParser.parse(data: data)
        return [Route(
            name: track.name ?? first.name,
            distanceKm: track.distanceKm,
            elevationGainM: track.elevationGainM,
            surfaces: SurfaceBreakdown(distanceKmBySurface: [:]),
            suggestedBikeType: .gravel,
            start: track.coordinates.first,
            end: track.coordinates.last,
            coordinates: track.coordinates,
            bearingSegments: track.bearingSegments()
        )]
    }

    public func listRoutes() async throws -> [StravaRoute] {
        struct AthleteResponse: Decodable { var id: Int }
        struct RouteResponse: Decodable {
            var id_str: String
            var name: String
            var distance: Double
        }
        let athlete: AthleteResponse = try await get(path: "athlete")
        let routes: [RouteResponse] = try await get(path: "athletes/\(athlete.id)/routes")
        return routes.map { StravaRoute(id: $0.id_str, name: $0.name, distanceKm: $0.distance / 1000) }
    }

    public func exportRouteGPX(routeID: String) async throws -> Data {
        try await getData(path: "routes/\(routeID)/export_gpx")
    }

    public func recentActivities(monthsAgo: Int) async throws -> [StravaActivity] {
        struct ActivityResponse: Decodable {
            var id: Int
            var name: String
            var start_date: Date
            var distance: Double
            var moving_time: Double
            var type: String
            var map: MapSummary?
            struct MapSummary: Decodable { var summary_polyline: String? }
        }
        let since = Calendar.current.date(byAdding: .month, value: -monthsAgo, to: .now) ?? .distantPast
        let activities: [ActivityResponse] = try await get(
            path: "athlete/activities",
            query: ["after": String(Int(since.timeIntervalSince1970)), "per_page": "100"]
        )
        return activities
            .filter { ["Ride", "GravelRide", "MountainBikeRide", "VirtualRide"].contains($0.type) }
            .map { activity in
                StravaActivity(
                    id: String(activity.id),
                    name: activity.name,
                    startDate: activity.start_date,
                    distanceKm: activity.distance / 1000,
                    movingTimeSeconds: activity.moving_time,
                    // ponytail: uses the summary polyline already returned by
                    // this list call instead of a per-activity `/streams`
                    // request — avoids an N-request fan-out against Strava's
                    // 100-req/15min rate limit. Coarse-enough for
                    // `ActivityMatcher`'s overlap threshold; upgrade to real
                    // streams if matching accuracy ever needs it.
                    coordinates: activity.map?.summary_polyline.map(PolylineDecoder.decode) ?? []
                )
            }
    }

    public func activityWebURL(activityID: String) -> URL {
        URL(string: "https://www.strava.com/activities/\(activityID)")!
    }

    private func get<T: Decodable>(path: String, query: [String: String] = [:]) async throws -> T {
        let data = try await getData(path: path, query: query)
        return try JSONDecoder.stravaDecoder.decode(T.self, from: data)
    }

    private func getData(path: String, query: [String: String] = [:]) async throws -> Data {
        let accessToken = try await tokenManager.validAccessToken()
        var components = URLComponents(url: apiBaseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw StravaClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw StravaClientError.requestFailed(status: http.statusCode) }
        return data
    }
}

private extension JSONDecoder {
    static let stravaDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

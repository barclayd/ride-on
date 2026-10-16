import Foundation
import Models

/// Builds the Routes tab from the API: every saved route (`GET /routes`), the shortlist
/// (`GET /route-selection`) and the rides marked as ridden (`GET /rides`), with each route's
/// geometry and last ride (docs/api.md, "External route imports and library" and "Saved
/// shortlist"; docs/ride-history.md). Shortlist edits save with `PUT /route-selection`.
public enum RouteLibraryLoader {
    /// The shortlist as the API last had it, and the version the next save must send.
    public struct Shortlist: Hashable, Sendable {
        public var version: Int
        public var routeIDs: [UUID]
    }

    /// The API's cap on the shortlist.
    public static let shortlistLimit = 12

    public static func load() async throws -> (library: RouteLibrary, shortlist: Shortlist) {
        async let shortlist = Self.shortlist()
        async let summaries = allRoutes()
        // ponytail: the newest 100 rides only; page with `nextCursor` once History scrolls that far.
        async let history: RidesResponse = RideOnAPI.send("/rides", query: [URLQueryItem(name: "limit", value: "100")])
        let routes = try await summaries
        async let lastRidden = Self.lastRidden(routes.map(\.id))
        async let geometry = Self.geometry(routes)
        let library = try await Self.library(routes: routes, geometry: geometry, lastRidden: lastRidden,
                                             rides: history.rides, shortlist: shortlist.routeIDs)
        return (library, try await shortlist)
    }

    /// Saves `routeIDs` as the shortlist. When something else changed it after `base` was read
    /// (the extension, another device), this edit's additions and removals are replayed onto the
    /// newer list rather than overwriting it, as the API asks (docs/api.md, "Saved shortlist").
    public static func save(_ routeIDs: [UUID], over base: Shortlist) async throws -> Shortlist {
        do {
            return try await put(routeIDs, version: base.version)
        } catch let failure as RideOnAPI.Failure where failure.code == "SELECTION_VERSION_CONFLICT" {
            let current = try await shortlist()
            let merged = merge(routeIDs, base: base.routeIDs, onto: current.routeIDs)
            return merged == current.routeIDs ? current : try await put(merged, version: current.version)
        }
    }

    /// `edited`'s changes from `base`, applied to `current`: removals taken out, additions appended
    /// in the order they were made, the rest in `current`'s order.
    public static func merge(_ edited: [UUID], base: [UUID], onto current: [UUID]) -> [UUID] {
        let removed = Set(base).subtracting(edited)
        var merged = current.filter { !removed.contains($0) }
        for id in edited where !base.contains(id) && !merged.contains(id) { merged.append(id) }
        return Array(merged.prefix(shortlistLimit))
    }

    // MARK: Requests

    private static func shortlist() async throws -> Shortlist {
        let response: SelectionResponse = try await RideOnAPI.send("/route-selection")
        return Shortlist(response.selection)
    }

    private static func put(_ routeIDs: [UUID], version: Int) async throws -> Shortlist {
        let response: SelectionResponse = try await RideOnAPI.send("/route-selection", method: "PUT",
                                                                   body: SelectionUpdate(expectedVersion: version, routeIds: routeIDs.map(\.apiID)))
        return Shortlist(response.selection)
    }

    private static func allRoutes() async throws -> [RouteSummary] {
        var routes: [RouteSummary] = []
        var cursor: String?
        repeat {
            let query = [URLQueryItem(name: "limit", value: "100")] + (cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
            let page: RoutesResponse = try await RideOnAPI.send("/routes", query: query)
            routes += page.routes
            cursor = page.nextCursor
        } while cursor != nil
        return routes
    }

    /// Each route's latest ride day, "2026-10-03", across all its history.
    private static func lastRidden(_ ids: [String]) async throws -> [String: String] {
        var days: [String: String] = [:]
        for start in stride(from: 0, to: ids.count, by: 100) {
            let chunk = Array(ids[start..<min(start + 100, ids.count)])
            let response: RideBoardLoader.SummariesResponse = try await RideOnAPI.send("/rides/summaries", body: RideBoardLoader.SummariesRequest(routeIds: chunk))
            for summary in response.summaries { days[summary.routeId] = summary.lastRiddenOn }
        }
        return days
    }

    /// Every route's path, six requests at a time, reusing ones already fetched for the same
    /// route version.
    private static func geometry(_ routes: [RouteSummary]) async throws -> [String: [Coordinate]] {
        let wanted = routes.filter { $0.geometryStatus == "available" }
        var paths: [String: [Coordinate]] = [:]
        var missing: [RouteSummary] = []
        for route in wanted {
            if let cached = await geometryCache.path(route.id, version: route.version) { paths[route.id] = cached } else { missing.append(route) }
        }
        try await withThrowingTaskGroup(of: (RouteSummary, [Coordinate]).self) { group in
            var queue = missing[...]
            func next() {
                guard let route = queue.popFirst() else { return }
                group.addTask {
                    let response: RideBoardLoader.GeometryResponse = try await RideOnAPI.send("/routes/\(route.id)/geometry")
                    return (route, response.geometry.map { PolylineDecoder.decode($0.data, precision: 6) } ?? [])
                }
            }
            for _ in 0..<6 { next() }
            while let (route, path) = try await group.next() {
                paths[route.id] = path
                await geometryCache.store(path, for: route.id, version: route.version)
                next()
            }
        }
        return paths
    }

    private static let geometryCache = GeometryCache()

    private actor GeometryCache {
        private var paths: [String: (version: Int, path: [Coordinate])] = [:]

        func path(_ id: String, version: Int) -> [Coordinate]? {
            paths[id].flatMap { $0.version == version ? $0.path : nil }
        }

        func store(_ path: [Coordinate], for id: String, version: Int) {
            paths[id] = (version, path)
        }
    }

    // MARK: Mapping

    static func library(routes: [RouteSummary], geometry: [String: [Coordinate]], lastRidden: [String: String],
                        rides: [Ride], shortlist: [UUID]) -> RouteLibrary {
        let mapped = routes.compactMap { summary -> RouteLibrary.Route? in
            guard let id = UUID(uuidString: summary.id) else { return nil }
            return RouteLibrary.Route(id: id, name: summary.name, distanceKm: summary.distanceM / 1000, ascentM: summary.ascentM ?? 0,
                                      unpaved: summary.surfaceSummary?.unpavedFraction, source: source(summary.source),
                                      lastRidden: lastRidden[summary.id].flatMap(day), coordinates: geometry[summary.id] ?? [])
        }
        let byID = Dictionary(mapped.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let history = rides.compactMap { ride -> RouteLibrary.Ride? in
            guard let id = UUID(uuidString: ride.routeId), let riddenOn = day(ride.riddenOn) else { return nil }
            // The route as it was ridden; its path and source from the saved route, while it's still saved.
            let saved = byID[id]
            let route = RouteLibrary.Route(id: id, name: ride.route.name, distanceKm: ride.route.distanceM / 1000, ascentM: ride.route.ascentM ?? 0,
                                           unpaved: saved?.unpaved, source: saved?.source ?? .gpxFile, lastRidden: saved?.lastRidden,
                                           coordinates: saved?.coordinates ?? [])
            return RouteLibrary.Ride(id: ride.id, route: route, riddenOn: riddenOn, plan: ride.plan.map(plan))
        }
        return RouteLibrary(routes: mapped, shortlist: shortlist, shortlistLimit: shortlistLimit, rides: history)
    }

    static func source(_ source: RouteSummary.Source?) -> RouteLibrary.Source {
        switch source?.providerId {
        case "cycle-travel": .cycleTravel
        case "strava": .strava
        case "garmin": .garmin
        default: .gpxFile
        }
    }

    /// The forecast saved when the ride was planned: the middle of its temperature range, the
    /// average wind and the sky over most of the distance.
    static func plan(_ plan: Ride.Plan) -> RouteLibrary.Plan {
        let c = plan.conditions
        return RouteLibrary.Plan(start: plan.departureAt, temperatureC: ((c.temperatureC.minimum + c.temperatureC.maximum) / 2).rounded(),
                                 windKph: c.averageWindSpeedKph, sky: RideBoardLoader.sky(c))
    }

    /// "2026-10-03" → midnight that day here: a calendar day, never a time (docs/ride-history.md).
    static func day(_ string: String) -> Date? {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

// MARK: - Wire types

extension RouteLibraryLoader {
    struct SelectionResponse: Decodable {
        struct Selection: Decodable { var version: Int; var routeIds: [String] }
        var selection: Selection
    }

    struct SelectionUpdate: Encodable {
        var expectedVersion: Int
        var routeIds: [String]
    }

    struct RoutesResponse: Decodable {
        var routes: [RouteSummary]
        var nextCursor: String?
    }

    struct RouteSummary: Decodable, Sendable {
        struct Source: Decodable, Sendable { var providerId: String }
        struct Surface: Decodable, Sendable { var unpavedFraction: Double? }
        var id: String
        var name: String
        var distanceM: Double
        var ascentM: Double?
        var version: Int
        var geometryStatus: String?
        var surfaceSummary: Surface?
        var source: Source?
    }

    struct RidesResponse: Decodable {
        var rides: [Ride]
    }

    struct Ride: Decodable {
        struct Snapshot: Decodable { var name: String; var distanceM: Double; var ascentM: Double? }
        struct Plan: Decodable { var departureAt: Date; var conditions: RideBoardLoader.Conditions }
        var id: String
        var routeId: String
        var route: Snapshot
        var riddenOn: String
        /// A plan the app can't read shows as "No forecast saved" rather than failing History.
        var plan: Plan?

        private enum CodingKeys: String, CodingKey { case id, routeId, route, riddenOn, plan }

        init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            routeId = try container.decode(String.self, forKey: .routeId)
            route = try container.decode(Snapshot.self, forKey: .route)
            riddenOn = try container.decode(String.self, forKey: .riddenOn)
            plan = try? container.decodeIfPresent(Plan.self, forKey: .plan)
        }
    }
}

extension RouteLibraryLoader.Shortlist {
    init(_ selection: RouteLibraryLoader.SelectionResponse.Selection) {
        self.init(version: selection.version, routeIDs: selection.routeIds.compactMap(UUID.init(uuidString:)))
    }
}

private extension UUID {
    /// The API's ids are lowercase and it matches them exactly.
    var apiID: String { uuidString.lowercased() }
}

import Foundation
import SwiftData
import Models
import Engine

/// Lists the athlete's Strava routes and imports any not already synced
/// (dedup by `stravaRouteID`) via the existing GPX import pipeline —
/// user-initiated, and once imported the route is app-owned data (PLAN.md
/// Strava policy).
@MainActor
public struct StravaRouteSyncService {
    public var stravaClient: any StravaClientProtocol
    public var importer: RouteImporter

    public init(stravaClient: any StravaClientProtocol, importer: RouteImporter) {
        self.stravaClient = stravaClient
        self.importer = importer
    }

    @discardableResult
    public func syncRoutes() async throws -> Int {
        let remoteRoutes = try await stravaClient.listRoutes()
        let existingIDs = Set(try importer.modelContext.fetch(FetchDescriptor<RouteModel>()).compactMap(\.stravaRouteID))

        var importedCount = 0
        for remote in remoteRoutes where !existingIDs.contains(remote.id) {
            let data = try await stravaClient.exportRouteGPX(routeID: remote.id)
            try await importer.importGPX(data: data, fallbackName: remote.name, source: .strava, stravaRouteID: remote.id)
            importedCount += 1
        }
        return importedCount
    }
}

/// Fetches 3 months of Strava activities, matches them by geometry overlap
/// to persisted routes (`Engine.ActivityMatcher`), writes new `.strava`-
/// sourced ride logs (deduped by `stravaActivityID`), and derives per-surface
/// cruising speed from the matches (`Engine.SpeedModelDerivation`). Raw
/// activity data is used in-memory only and discarded once these derived
/// aggregates are written — Strava's 7-day cache limit never applies since
/// nothing raw is persisted (PLAN.md).
@MainActor
public struct StravaActivitySyncService {
    public var stravaClient: any StravaClientProtocol
    public var modelContext: ModelContext

    public init(stravaClient: any StravaClientProtocol, modelContext: ModelContext) {
        self.stravaClient = stravaClient
        self.modelContext = modelContext
    }

    @discardableResult
    public func syncActivities(
        routes: [RouteModel],
        currentSpeeds: [SurfaceType: Double],
        monthsAgo: Int = 3
    ) async throws -> [SurfaceType: Double] {
        let since = Calendar.current.date(byAdding: .month, value: -monthsAgo, to: .now) ?? .distantPast
        let activities = try await stravaClient.recentActivities(monthsAgo: monthsAgo)
        let existingStravaIDs = Set(try modelContext.fetch(FetchDescriptor<RideLogModel>()).compactMap(\.stravaActivityID))
        let candidates = routes.map { (id: $0.id, coordinates: $0.coordinates) }

        var observations: [(surfaceShare: [SurfaceType: Double], avgSpeedKph: Double)] = []
        for activity in activities where activity.startDate >= since {
            guard let matchedID = ActivityMatcher.bestMatch(activityCoordinates: activity.coordinates, candidates: candidates) else { continue }
            guard let route = routes.first(where: { $0.id == matchedID }) else { continue }

            if !existingStravaIDs.contains(activity.id) {
                modelContext.insert(RideLogModel(date: activity.startDate, routeID: matchedID, source: .strava, stravaActivityID: activity.id))
            }

            guard activity.movingTimeSeconds > 0, let surfaces = route.surfaces, surfaces.totalKm > 0 else { continue }
            let avgSpeedKph = activity.distanceKm / (activity.movingTimeSeconds / 3600)
            observations.append((surfaceShare: surfaces.shareBySurface, avgSpeedKph: avgSpeedKph))
        }

        return SpeedModelDerivation.deriveSpeeds(observations: observations, defaults: currentSpeeds)
    }
}

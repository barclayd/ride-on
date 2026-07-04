import Foundation
import SwiftData
import Models
import Engine

/// GPX file/Data -> parse -> classify -> persist. Parse failure (bad GPX)
/// is fatal and thrown — there's no route to build without geometry.
/// Classify failure (network/worker) is **non-fatal**: the route is still
/// persisted with `surfaces == nil` / `suggestedType == nil` and
/// `needsClassification = true` for a later retry.
@MainActor
public struct RouteImporter {
    public var classifyClient: any ClassifyClient
    public var elevationClient: any ElevationClient
    public var modelContext: ModelContext

    public init(
        classifyClient: any ClassifyClient,
        elevationClient: any ElevationClient,
        modelContext: ModelContext
    ) {
        self.classifyClient = classifyClient
        self.elevationClient = elevationClient
        self.modelContext = modelContext
    }

    @discardableResult
    public func importGPX(fileURL: URL) async throws -> RouteModel {
        let didAccess = fileURL.startAccessingSecurityScopedResource()
        defer { if didAccess { fileURL.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: fileURL)
        let fallbackName = fileURL.deletingPathExtension().lastPathComponent
        return try await importGPX(data: data, fallbackName: fallbackName)
    }

    @discardableResult
    public func importGPX(
        data: Data,
        fallbackName: String = "Imported Route",
        source: RouteSource = .gpxImport,
        stravaRouteID: String? = nil
    ) async throws -> RouteModel {
        let track = try GPXParser.parse(data: data)

        // Route-planner exports (cycle.travel, some komoot) carry no <ele>
        // at all, which would silently show "0 m gain" for a genuinely hilly
        // route — look the heights up instead. Failure is non-fatal, same
        // policy as classify: the route still imports, gain stays 0.
        var elevations = track.points.map(\.elevationM)
        var elevationGainM = track.elevationGainM
        if elevations.compactMap({ $0 }).count < 2,
           let fetched = try? await fetchElevations(coordinates: track.coordinates) {
            elevations = fetched
            elevationGainM = ElevationSmoother.smoothedGain(rawElevations: fetched.compactMap { $0 })
        }

        let model = RouteModel(
            name: track.name ?? fallbackName,
            distanceKm: track.distanceKm,
            elevationGainM: elevationGainM,
            coordinates: track.coordinates,
            elevations: elevations,
            bearingSegments: track.bearingSegments(),
            source: source,
            stravaRouteID: stravaRouteID,
            importedFrom: track.creator
        )

        do {
            let result = try await classifyClient.classify(coordinates: track.coordinates)
            model.surfaces = result.surfaces
            model.suggestedType = result.suggestedType
            model.needsClassification = false
        } catch {
            model.needsClassification = true
        }

        modelContext.insert(model)
        return model
    }

    /// Caps upstream lookups: beyond `maxElevationSamples` points, elevations
    /// are fetched on an even stride and mapped back to full resolution by
    /// nearest sample. ponytail: ele-less GPX comes from route planners whose
    /// exports are already simplified, so the cap rarely bites.
    static let maxElevationSamples = 2000

    private func fetchElevations(coordinates: [Coordinate]) async throws -> [Double?] {
        guard coordinates.count > Self.maxElevationSamples else {
            return try await elevationClient.elevations(coordinates: coordinates)
        }
        let indices = Self.sampleIndices(count: coordinates.count, cap: Self.maxElevationSamples)
        let sampled = try await elevationClient.elevations(coordinates: indices.map { coordinates[$0] })
        let step = Double(coordinates.count - 1) / Double(indices.count - 1)
        return coordinates.indices.map { i in
            sampled[min(sampled.count - 1, Int((Double(i) / step).rounded()))]
        }
    }

    // Visible for testing: evenly spaced indices covering both endpoints.
    nonisolated static func sampleIndices(count: Int, cap: Int) -> [Int] {
        guard count > cap else { return Array(0..<count) }
        let step = Double(count - 1) / Double(cap - 1)
        return (0..<cap).map { Int((Double($0) * step).rounded()) }
    }
}

import Foundation
import SwiftData
import RideOnCore

/// GPX file/Data -> parse -> classify -> persist. Parse failure (bad GPX)
/// is fatal and thrown — there's no route to build without geometry.
/// Classify failure (network/worker) is **non-fatal**: the route is still
/// persisted with `surfaces == nil` / `suggestedType == nil` and
/// `needsClassification = true` for a later retry.
@MainActor
struct RouteImporter {
    var classifyClient: any ClassifyClient
    var modelContext: ModelContext

    @discardableResult
    func importGPX(fileURL: URL) async throws -> RouteModel {
        let didAccess = fileURL.startAccessingSecurityScopedResource()
        defer { if didAccess { fileURL.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: fileURL)
        let fallbackName = fileURL.deletingPathExtension().lastPathComponent
        return try await importGPX(data: data, fallbackName: fallbackName)
    }

    @discardableResult
    func importGPX(data: Data, fallbackName: String = "Imported Route") async throws -> RouteModel {
        let track = try GPXParser.parse(data: data)

        let model = RouteModel(
            name: track.name ?? fallbackName,
            distanceKm: track.distanceKm,
            elevationGainM: track.elevationGainM,
            coordinates: track.coordinates,
            elevations: track.points.map(\.elevationM),
            bearingSegments: track.bearingSegments(),
            source: .gpxImport
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
}

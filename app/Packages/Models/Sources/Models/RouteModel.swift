import Foundation
import SwiftData

/// Where a persisted route came from — GPX file import today, Strava route
/// sync in Phase 6.
public enum RouteSource: String, Codable, Sendable {
    case gpxImport
    case strava
}

/// The persisted, CloudKit-mirrored route record. Deliberately distinct from
/// `Route` — `Route` is the platform-free value type the scoring engine
/// works with; this is SwiftData's on-disk shape, richer (raw geometry,
/// import provenance) than the engine needs.
///
/// CloudKit-safe per PLAN.md: every attribute has a default (no required
/// values with no default), no `@Attribute(.unique)` constraints (CloudKit
/// doesn't support unique constraints on a `CKRecord` field).
@Model
public final class RouteModel {
    public var id: UUID = UUID()
    public var name: String = "Untitled Route"
    /// User-authored description shown in Route Detail — free text that may
    /// contain external links (auto-linked at display time). Empty = none.
    public var notes: String = ""
    public var distanceKm: Double = 0
    public var elevationGainM: Double = 0

    /// Packed `[lat, lon, lat, lon, ...]` `Double`s — see `RouteModel.pack`.
    /// Binary rather than a polyline string: no encode/decode step needed,
    /// and this is on-device storage, not a wire format.
    public var coordinatesData: Data = Data()
    /// Packed elevation `Double`s, parallel to `coordinatesData`; `.nan` is
    /// the "missing" sentinel (GPX tolerates points with no `<ele>`).
    public var elevationsData: Data = Data()

    /// JSON-encoded `SurfaceBreakdown`; nil until `/classify` succeeds.
    public var surfacesData: Data?
    public var suggestedTypeRaw: String?
    public var userOverriddenTypeRaw: String?
    /// Set when import's classify call failed — surfaced in the UI with a
    /// retry affordance later; import itself still succeeds.
    public var needsClassification: Bool = false
    /// JSON-encoded `[BearingSegment]`; the wind-alignment factor's raw
    /// material (Phase 3).
    public var bearingSegmentsData: Data?

    public var createdAt: Date = Date.now
    public var sourceRaw: String = RouteSource.gpxImport.rawValue
    public var stravaRouteID: String?
    /// The GPX root `creator` attribute ("Garmin Connect", "cycle.travel", …)
    /// — shown as import provenance in Route Detail.
    public var importedFrom: String?

    public init(
        id: UUID = UUID(),
        name: String = "Untitled Route",
        notes: String = "",
        distanceKm: Double = 0,
        elevationGainM: Double = 0,
        coordinates: [Coordinate] = [],
        elevations: [Double?] = [],
        surfaces: SurfaceBreakdown? = nil,
        suggestedType: SuggestedRouteType? = nil,
        userOverriddenType: SuggestedRouteType? = nil,
        needsClassification: Bool = false,
        bearingSegments: [BearingSegment] = [],
        createdAt: Date = .now,
        source: RouteSource = .gpxImport,
        stravaRouteID: String? = nil,
        importedFrom: String? = nil
    ) {
        self.id = id
        self.name = name
        self.notes = notes
        self.distanceKm = distanceKm
        self.elevationGainM = elevationGainM
        self.coordinatesData = RouteModel.pack(coordinates: coordinates)
        self.elevationsData = RouteModel.pack(elevations: elevations)
        self.surfacesData = surfaces.flatMap { try? JSONEncoder().encode($0) }
        self.suggestedTypeRaw = suggestedType?.rawValue
        self.userOverriddenTypeRaw = userOverriddenType?.rawValue
        self.needsClassification = needsClassification
        self.bearingSegmentsData = bearingSegments.isEmpty ? nil : try? JSONEncoder().encode(bearingSegments)
        self.createdAt = createdAt
        self.sourceRaw = source.rawValue
        self.stravaRouteID = stravaRouteID
        self.importedFrom = importedFrom
    }
}

public extension RouteModel {
    var coordinates: [Coordinate] { RouteModel.unpackCoordinates(coordinatesData) }
    var elevations: [Double?] { RouteModel.unpackElevations(elevationsData) }

    /// False when the GPX carried no `<ele>` and the import-time elevation
    /// fill failed too — the UI shows "no data" instead of a misleading 0 m.
    var hasElevationData: Bool { elevations.contains { $0 != nil } }

    var surfaces: SurfaceBreakdown? {
        get { surfacesData.flatMap { try? JSONDecoder().decode(SurfaceBreakdown.self, from: $0) } }
        set { surfacesData = newValue.flatMap { try? JSONEncoder().encode($0) } }
    }

    var suggestedType: SuggestedRouteType? {
        get { suggestedTypeRaw.flatMap(SuggestedRouteType.init(rawValue:)) }
        set { suggestedTypeRaw = newValue?.rawValue }
    }

    var userOverriddenType: SuggestedRouteType? {
        get { userOverriddenTypeRaw.flatMap(SuggestedRouteType.init(rawValue:)) }
        set { userOverriddenTypeRaw = newValue?.rawValue }
    }

    /// What the UI should actually show/use: the user's override if they
    /// made one, else the classifier's suggestion.
    var effectiveType: SuggestedRouteType? { userOverriddenType ?? suggestedType }

    var bearingSegments: [BearingSegment] {
        bearingSegmentsData.flatMap { try? JSONDecoder().decode([BearingSegment].self, from: $0) } ?? []
    }

    var source: RouteSource { RouteSource(rawValue: sourceRaw) ?? .gpxImport }

    static func pack(coordinates: [Coordinate]) -> Data {
        var flat: [Double] = []
        flat.reserveCapacity(coordinates.count * 2)
        for coordinate in coordinates {
            flat.append(coordinate.latitude)
            flat.append(coordinate.longitude)
        }
        return flat.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    static func unpackCoordinates(_ data: Data) -> [Coordinate] {
        let doubles = unpackDoubles(data)
        var result: [Coordinate] = []
        result.reserveCapacity(doubles.count / 2)
        var index = 0
        while index + 1 < doubles.count {
            result.append(Coordinate(latitude: doubles[index], longitude: doubles[index + 1]))
            index += 2
        }
        return result
    }

    static func pack(elevations: [Double?]) -> Data {
        let flat = elevations.map { $0 ?? Double.nan }
        return flat.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    static func unpackElevations(_ data: Data) -> [Double?] {
        unpackDoubles(data).map { $0.isNaN ? nil : $0 }
    }

    private static func unpackDoubles(_ data: Data) -> [Double] {
        guard !data.isEmpty else { return [] }
        return data.withUnsafeBytes { rawBuffer in
            Array(rawBuffer.bindMemory(to: Double.self))
        }
    }
}

import Foundation

public enum SurfaceType: String, Codable, CaseIterable, Sendable {
    case busyRoad
    case paved
    case unpaved
    case path
    /// The `/classify` worker returns this bucket for edges it couldn't
    /// attribute a surface to.
    case unknown
}

/// Mirrors the worker's `/classify` `suggestedType` — deliberately distinct
/// from `BikeType` (which describes the rider's bike, not a route's terrain)
/// since "mixed" isn't a bike you own.
public enum SuggestedRouteType: String, Codable, CaseIterable, Sendable {
    case road
    case gravel
    case mixed
}

/// Distance ridden on each surface type, in kilometers. Populated by the
/// `/classify` worker call at import time (Phase 2); a route with everything
/// on one surface is a fine placeholder until then.
public struct SurfaceBreakdown: Codable, Sendable, Hashable {
    public var distanceKmBySurface: [SurfaceType: Double]

    public init(distanceKmBySurface: [SurfaceType: Double]) {
        self.distanceKmBySurface = distanceKmBySurface
    }

    public var totalKm: Double {
        distanceKmBySurface.values.reduce(0, +)
    }

    /// Fraction of `totalKm` on each surface; empty if there's no distance
    /// data yet. Shared by `SpeedModel`-driven duration estimates and the
    /// weather time-window calc.
    public var shareBySurface: [SurfaceType: Double] {
        guard totalKm > 0 else { return [:] }
        return distanceKmBySurface.mapValues { $0 / totalKm }
    }
}

public struct Route: Identifiable, Codable, Sendable, Hashable {
    public var id: UUID
    public var name: String
    public var distanceKm: Double
    public var elevationGainM: Double
    public var surfaces: SurfaceBreakdown
    public var suggestedBikeType: BikeType
    public var start: Coordinate?
    public var end: Coordinate?
    /// Full track polyline, for the novelty factor's geometric overlap check
    /// (Phase 3). Empty for routes that only have start/end on hand.
    public var coordinates: [Coordinate]
    /// ~1km bearing segments, for the wind-alignment factor (Phase 3).
    public var bearingSegments: [BearingSegment]

    public init(
        id: UUID = UUID(),
        name: String,
        distanceKm: Double,
        elevationGainM: Double,
        surfaces: SurfaceBreakdown,
        suggestedBikeType: BikeType,
        start: Coordinate? = nil,
        end: Coordinate? = nil,
        coordinates: [Coordinate] = [],
        bearingSegments: [BearingSegment] = []
    ) {
        self.id = id
        self.name = name
        self.distanceKm = distanceKm
        self.elevationGainM = elevationGainM
        self.surfaces = surfaces
        self.suggestedBikeType = suggestedBikeType
        self.start = start
        self.end = end
        self.coordinates = coordinates
        self.bearingSegments = bearingSegments
    }
}

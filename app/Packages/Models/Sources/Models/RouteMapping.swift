import Foundation

// RouteModel (SwiftData persistence) <-> Route (platform-free scoring value
// type, in the Engine package). RouteModel carries the raw geometry a
// `Route` doesn't (coordinates, bearing segments, import provenance).

public extension RouteModel {
    /// Projects into the scoring-layer `Route`. `BikeType` mapping:
    /// `.mixed` -> `.gravel` (a gravel bike is the safer "can ride most
    /// things" guess), and an unclassified route (`effectiveType == nil`,
    /// still awaiting `/classify`) also defaults to `.gravel` for the same
    /// reason.
    func asRoute() -> Route {
        let bikeType: BikeType
        switch effectiveType {
        case .road: bikeType = .road
        case .gravel, .mixed, nil: bikeType = .gravel
        }
        return Route(
            id: id,
            name: name,
            distanceKm: distanceKm,
            elevationGainM: elevationGainM,
            surfaces: surfaces ?? SurfaceBreakdown(distanceKmBySurface: [:]),
            suggestedBikeType: bikeType,
            start: coordinates.first,
            end: coordinates.last,
            coordinates: coordinates,
            bearingSegments: bearingSegments
        )
    }
}

public extension Route {
    /// Builds a bare `RouteModel` from a scoring-layer `Route`. Used for
    /// fixtures/tests — real GPX imports go through `RouteImporter`, which
    /// has the full track geometry a `Route` alone doesn't carry.
    func asModel(source: RouteSource = .gpxImport) -> RouteModel {
        RouteModel(
            id: id,
            name: name,
            distanceKm: distanceKm,
            elevationGainM: elevationGainM,
            coordinates: coordinates.isEmpty ? [start, end].compactMap { $0 } : coordinates,
            surfaces: surfaces,
            suggestedType: suggestedBikeType.asSuggestedRouteType,
            bearingSegments: bearingSegments,
            source: source
        )
    }
}

private extension BikeType {
    var asSuggestedRouteType: SuggestedRouteType {
        switch self {
        case .road: .road
        case .gravel: .gravel
        case .mtb: .mixed
        }
    }
}

import Foundation
import MapKit
import Models

/// Real MapKit ETAs (PLAN.md: "auto/cycling/transit").
public struct LiveETAProvider: ETAProviding {
    public init() {}

    public func travelTime(from: Coordinate, to: Coordinate, mode: TravelMode) async throws -> TimeInterval {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: from.clLocationCoordinate2D))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to.clLocationCoordinate2D))
        request.transportType = mode.transportType

        do {
            let response = try await MKDirections(request: request).calculateETA()
            return response.expectedTravelTime
        } catch {
            // Graceful regional-failure handling: MapKit throws an opaque
            // NSError (no routing data for the mode/region — rural transit,
            // whole countries for some modes) rather than a typed
            // "unavailable" case. Surface our own typed error so callers can
            // show "ETA unavailable" instead of a raw MapKit error string.
            throw ETAProvidingError.unavailable(mode: mode)
        }
    }
}

public enum ETAProvidingError: Error, Sendable {
    case unavailable(mode: TravelMode)
}

private extension Coordinate {
    var clLocationCoordinate2D: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

private extension TravelMode {
    var transportType: MKDirectionsTransportType {
        switch self {
        case .automobile: .automobile
        case .cycling: .cycling
        case .transit: .transit
        }
    }
}

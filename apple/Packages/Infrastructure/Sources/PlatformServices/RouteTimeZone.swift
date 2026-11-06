import CoreLocation
import MapKit
import Domain

public enum RouteTimeZone {
    /// Resolve the route's start, without requesting the rider's location or permission.
    @MainActor public static func identifier(at coordinate: Coordinate) async -> String? {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let request = MKReverseGeocodingRequest(location: location) else { return nil }
        return try? await request.mapItems.first?.timeZone?.identifier
    }
}

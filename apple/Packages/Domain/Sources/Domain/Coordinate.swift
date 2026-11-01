import Foundation

/// Plain lat/lon pair. `CLLocationCoordinate2D` isn't `Codable`/`Hashable` on
/// every SDK we target, so we roundtrip through this instead of fighting it.
public struct Coordinate: Codable, Sendable, Hashable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

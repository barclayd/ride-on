import Foundation
import SwiftData

/// A saved start location (home, work, a friend's place) for ETA scoring.
@Model
public final class SavedPlaceModel {
    public var id: UUID = UUID()
    public var name: String = ""
    public var latitude: Double = 0
    public var longitude: Double = 0

    public init(id: UUID = UUID(), name: String = "", coordinate: Coordinate = Coordinate(latitude: 0, longitude: 0)) {
        self.id = id
        self.name = name
        self.latitude = coordinate.latitude
        self.longitude = coordinate.longitude
    }
}

public extension SavedPlaceModel {
    var coordinate: Coordinate {
        get { Coordinate(latitude: latitude, longitude: longitude) }
        set {
            latitude = newValue.latitude
            longitude = newValue.longitude
        }
    }
}

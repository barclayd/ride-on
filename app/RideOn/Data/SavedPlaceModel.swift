import Foundation
import SwiftData
import RideOnCore

/// A saved start location (home, work, a friend's place) for ETA scoring.
@Model
final class SavedPlaceModel {
    var id: UUID = UUID()
    var name: String = ""
    var latitude: Double = 0
    var longitude: Double = 0

    init(id: UUID = UUID(), name: String = "", coordinate: Coordinate = Coordinate(latitude: 0, longitude: 0)) {
        self.id = id
        self.name = name
        self.latitude = coordinate.latitude
        self.longitude = coordinate.longitude
    }
}

extension SavedPlaceModel {
    var coordinate: Coordinate {
        get { Coordinate(latitude: latitude, longitude: longitude) }
        set {
            latitude = newValue.latitude
            longitude = newValue.longitude
        }
    }
}

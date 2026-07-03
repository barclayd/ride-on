import Foundation

public struct SavedPlace: Identifiable, Codable, Sendable, Hashable {
    public var id: UUID
    public var name: String
    public var coordinate: Coordinate

    public init(id: UUID = UUID(), name: String, coordinate: Coordinate) {
        self.id = id
        self.name = name
        self.coordinate = coordinate
    }
}

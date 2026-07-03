import Foundation

public enum BikeType: String, Codable, CaseIterable, Sendable {
    case road
    case gravel
    case mtb
}

public struct Bike: Identifiable, Codable, Sendable, Hashable {
    public var id: UUID
    public var name: String
    public var type: BikeType

    public init(id: UUID = UUID(), name: String, type: BikeType) {
        self.id = id
        self.name = name
        self.type = type
    }
}

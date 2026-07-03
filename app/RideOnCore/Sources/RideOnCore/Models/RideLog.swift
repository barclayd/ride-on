import Foundation

/// A record that a route was ridden, feeding the novelty factor (Phase 3).
public struct RideLog: Identifiable, Codable, Sendable, Hashable {
    public var id: UUID
    public var routeID: UUID
    public var date: Date
    public var bikeID: UUID?

    public init(id: UUID = UUID(), routeID: UUID, date: Date, bikeID: UUID? = nil) {
        self.id = id
        self.routeID = routeID
        self.date = date
        self.bikeID = bikeID
    }
}

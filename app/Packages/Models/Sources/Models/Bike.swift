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

public extension Bike {
    /// ponytail: a fixed garage of three bikes stands in for real bike
    /// management (add/rename/delete a `Bike`, which isn't in the Phase 4
    /// scope) — the context pill and speed model editor just need something
    /// stable to pick from. Promote to a persisted, user-editable list if
    /// riders end up wanting more than one bike per type.
    static let samples: [Bike] = [
        Bike(id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, name: "Gravel Bike", type: .gravel),
        Bike(id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!, name: "Road Bike", type: .road),
        Bike(id: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!, name: "Mountain Bike", type: .mtb),
    ]
}

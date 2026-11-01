import Foundation

/// Letter grade for how well a day's conditions match a ride — the
/// user-facing face of `RankedRide.score`. `d` means the conditions
/// aren't worth riding in; the UI recommends sitting it out.
public enum RideTier: String, CaseIterable, Sendable, Comparable {
    case s = "S"
    case a = "A"
    case b = "B"
    case c = "C"
    case d = "D"

    public init(score: Double) {
        switch score {
        case 0.85...: self = .s
        case 0.70..<0.85: self = .a
        case 0.55..<0.70: self = .b
        case 0.40..<0.55: self = .c
        default: self = .d
        }
    }

    public var letter: String { rawValue }

    /// Below this, the recommendation flips to "don't ride".
    public var isWorthRiding: Bool { self != .d }

    /// One-phrase read on the tier, for badges and the breakdown header.
    public var summary: String {
        switch self {
        case .s: "Perfect conditions"
        case .a: "Great conditions"
        case .b: "Good conditions"
        case .c: "Rideable, not ideal"
        case .d: "Not worth riding"
        }
    }

    public static func < (lhs: RideTier, rhs: RideTier) -> Bool {
        // s is the highest tier; CaseIterable order is s...d.
        let order = RideTier.allCases
        return order.firstIndex(of: lhs)! > order.firstIndex(of: rhs)!
    }
}

public extension RankedRide {
    var tier: RideTier { RideTier(score: score) }
}

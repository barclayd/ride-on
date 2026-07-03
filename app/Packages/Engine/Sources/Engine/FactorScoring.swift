import Foundation
import Models

/// Every dimension the daily scorer weighs. Raw strings double as the key
/// into the user-adjustable weights panel (Settings, Phase 4).
public enum RideFactor: String, Codable, CaseIterable, Sendable {
    case timeBudget
    case wind
    case temperature
    case sky
    case rain
    case surfaceMatch
    case intent
    case novelty
}

/// One factor's opinion on one route for one day. `value` is always 0...1,
/// higher is better; `reason` is the human-readable explanation shown in the
/// breakdown sheet.
public struct FactorScore: Sendable, Hashable {
    public var factor: RideFactor
    public var value: Double
    public var reason: String

    public init(factor: RideFactor, value: Double, reason: String) {
        self.factor = factor
        self.value = min(max(value, 0), 1)
        self.reason = reason
    }
}

public protocol FactorScoring: Sendable {
    func score(route: Route, context: DailyContext) -> FactorScore
}

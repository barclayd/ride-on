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

public extension RideFactor {
    /// Presentation metadata for the breakdown sheet (`FactorRow`) and the
    /// weights panel. Plain strings, not `SwiftUI.Image`/`Color` — this stays
    /// platform-free like the rest of `Engine`; the UI layer turns
    /// `symbolName` into an `Image(systemName:)`.
    var displayName: String {
        switch self {
        case .timeBudget: "Time"
        case .wind: "Wind"
        case .temperature: "Temperature"
        case .sky: "Sky"
        case .rain: "Rain"
        case .surfaceMatch: "Surface"
        case .intent: "Intent"
        case .novelty: "Novelty"
        }
    }

    var symbolName: String {
        switch self {
        case .timeBudget: "clock"
        case .wind: "wind"
        case .temperature: "thermometer.medium"
        case .sky: "cloud.sun"
        case .rain: "cloud.rain"
        case .surfaceMatch: "road.lanes"
        case .intent: "flag.checkered"
        case .novelty: "sparkles"
        }
    }
}

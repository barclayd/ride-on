import Foundation
import Observation
import Models
import Engine

/// Rider-adjustable preferences (temp range, speed model, weights inputs).
///
/// ponytail: backed by plain `UserDefaults` JSON, not a SwiftData `@Model`.
/// It's a single global settings row — a whole model/CloudKit schema entry
/// for one object is overhead a `UserDefaults` blob doesn't need, and
/// `RiderPreferences` is already `Codable`. This does **not** sync via
/// CloudKit today (`UserDefaults` is local-only, unlike the SwiftData store
/// above which mirrors automatically). When cross-device prefs sync
/// matters, swap the storage for either `NSUbiquitousKeyValueStore` (same
/// shape, adds sync) or a singleton `@Model` row — don't need both.
@Observable
public final class PreferencesStore {
    private static let preferencesKey = "riderPreferences.v1"
    private static let weightsKey = "riderFactorWeights.v1"

    private let defaults: UserDefaults
    public var preferences: RiderPreferences {
        didSet { persistPreferences() }
    }

    /// Engine's `WeightedScorer` input — how much each `RideFactor` counts
    /// toward a route's score. Lives here (not on `RiderPreferences`) since
    /// `RideFactor` is an `Engine` type and `Models` can't depend on `Engine`
    /// (dependency runs the other way).
    public var weights: [RideFactor: Double] {
        didSet { persistWeights() }
    }

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if
            let data = defaults.data(forKey: Self.preferencesKey),
            let decoded = try? JSONDecoder().decode(RiderPreferences.self, from: data)
        {
            preferences = decoded
        } else {
            preferences = RiderPreferences()
        }

        if
            let data = defaults.data(forKey: Self.weightsKey),
            let decoded = try? JSONDecoder().decode([RideFactor: Double].self, from: data)
        {
            weights = decoded
        } else {
            weights = Dictionary(uniqueKeysWithValues: RideFactor.allCases.map { ($0, 1.0) })
        }
    }

    private func persistPreferences() {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        defaults.set(data, forKey: Self.preferencesKey)
    }

    private func persistWeights() {
        guard let data = try? JSONEncoder().encode(weights) else { return }
        defaults.set(data, forKey: Self.weightsKey)
    }
}

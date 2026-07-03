import Foundation
import Observation
import RideOnCore

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
final class PreferencesStore {
    private static let storageKey = "riderPreferences.v1"

    private let defaults: UserDefaults
    var preferences: RiderPreferences {
        didSet { persist() }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if
            let data = defaults.data(forKey: Self.storageKey),
            let decoded = try? JSONDecoder().decode(RiderPreferences.self, from: data)
        {
            preferences = decoded
        } else {
            preferences = RiderPreferences()
        }
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}

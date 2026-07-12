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
/// The Today context-pill inputs that survive relaunch — bike, hours,
/// intent. `backBy` deliberately isn't here: a return time is day-specific,
/// so it resets each launch.
public struct TodayRideSettings: Codable, Sendable, Hashable {
    public var bike: Bike
    public var hoursAvailable: Double
    public var intent: RideIntent

    public init(bike: Bike = Bike.samples[0], hoursAvailable: Double = 3, intent: RideIntent = .exploring) {
        self.bike = bike
        self.hoursAvailable = hoursAvailable
        self.intent = intent
    }
}

@Observable
public final class PreferencesStore {
    private static let preferencesKey = "riderPreferences.v1"
    private static let weightsKey = "riderFactorWeights.v1"
    private static let todaySettingsKey = "todayRideSettings.v1"
    private static let onboardingKey = "hasCompletedOnboarding.v1"
    private static let locationPrimedKey = "hasPrimedLocationPermission.v1"
    private static let healthPrimedKey = "hasPrimedHealthPermission.v1"
    private static let rideMatchingKey = "isRideMatchingEnabled.v1"

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

    /// Onboarding shows once, on first launch (Phase 5). `--reset-onboarding`
    /// forces it back on (E2E happy-path test); fixture-world otherwise
    /// defaults to "already completed" so the rest of the fixture-world UI
    /// suite keeps landing straight on Today, as it did before onboarding
    /// existed.
    public var hasCompletedOnboarding: Bool {
        didSet { defaults.set(hasCompletedOnboarding, forKey: Self.onboardingKey) }
    }

    /// DESIGN-SYSTEM.md §9: permissions are primed contextually, not upfront
    /// in onboarding — location primes on first Today entry, Health primes
    /// before ride matching is enabled. These just record "the explainer has
    /// been shown once", not the actual system authorization state.
    public var hasPrimedLocationPermission: Bool {
        didSet { defaults.set(hasPrimedLocationPermission, forKey: Self.locationPrimedKey) }
    }

    public var hasPrimedHealthPermission: Bool {
        didSet { defaults.set(hasPrimedHealthPermission, forKey: Self.healthPrimedKey) }
    }

    public var isRideMatchingEnabled: Bool {
        didSet { defaults.set(isRideMatchingEnabled, forKey: Self.rideMatchingKey) }
    }

    public var todaySettings: TodayRideSettings {
        didSet { persistTodaySettings() }
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

        if
            let data = defaults.data(forKey: Self.todaySettingsKey),
            let decoded = try? JSONDecoder().decode(TodayRideSettings.self, from: data)
        {
            todaySettings = decoded
        } else {
            todaySettings = TodayRideSettings()
        }

        if ProcessInfo.processInfo.arguments.contains("--reset-onboarding") {
            hasCompletedOnboarding = false
        } else if FixtureWorld.isEnabled {
            hasCompletedOnboarding = true
        } else {
            hasCompletedOnboarding = defaults.bool(forKey: Self.onboardingKey)
        }

        // Fixture-world defaults every "primed" flag to true, same as
        // onboarding above — a deterministic E2E world shouldn't pop a
        // priming sheet mid-test unless a test explicitly resets it, and no
        // test does today (Phase 5 scope is the priming UI existing, not a
        // dedicated E2E for it).
        hasPrimedLocationPermission = FixtureWorld.isEnabled || defaults.bool(forKey: Self.locationPrimedKey)
        hasPrimedHealthPermission = FixtureWorld.isEnabled || defaults.bool(forKey: Self.healthPrimedKey)
        isRideMatchingEnabled = defaults.bool(forKey: Self.rideMatchingKey)
    }

    private func persistPreferences() {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        defaults.set(data, forKey: Self.preferencesKey)
    }

    private func persistWeights() {
        guard let data = try? JSONEncoder().encode(weights) else { return }
        defaults.set(data, forKey: Self.weightsKey)
    }

    private func persistTodaySettings() {
        guard let data = try? JSONEncoder().encode(todaySettings) else { return }
        defaults.set(data, forKey: Self.todaySettingsKey)
    }
}

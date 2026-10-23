import Foundation
import Observation
import Models

/// The saved settings the Preferences tab edits: `user.settings` and `user.preferenceLevels` from
/// `GET /users/me` (docs/api.md, "Users and saved preferences"). Values are in the API's units
/// (°C, km/h, km); the screens convert for display.
public struct RiderSettings: Hashable, Sendable {
    public var riding: Riding
    public var preferences: Preferences
    public var units: Units?
    public var display: Display?
    public var sunshine: SunshineLevel
    public var rain: RainLevel
    /// `nil` from an API older than v0.25.0, which has no crosswind level; the picker hides.
    public var crosswind: CrosswindLevel?

    public init(riding: Riding, preferences: Preferences, units: Units? = nil, display: Display? = nil,
                sunshine: SunshineLevel, rain: RainLevel, crosswind: CrosswindLevel? = nil) {
        self.riding = riding
        self.preferences = preferences
        self.units = units
        self.display = display
        self.sunshine = sunshine
        self.rain = rain
        self.crosswind = crosswind
    }

    public struct Riding: Codable, Hashable, Sendable {
        public var averageSpeedKph: Double
        public var departureStepMinutes: Int
    }

    /// Only the parts of `settings.preferences` the app edits: weights and sunshine comfort are
    /// left alone, so the levels below stay the one way to change them.
    public struct Preferences: Codable, Hashable, Sendable {
        public var temperature: Temperature
        public var wind: Wind
        public var recentRides: RecentRides
        public var climbing: Climbing
        public var distance: Distance?
        public var minimumStandards: MinimumStandards

        public struct Temperature: Codable, Hashable, Sendable { public var comfortMinC, comfortMaxC: Double }
        /// `crosswindSensitivity` is left out: the API rejects it alongside `preferenceLevels.crosswind`,
        /// which is how the app sets it.
        public struct Wind: Codable, Hashable, Sendable {
            public var comfortableHeadwindKph, comfortableCrosswindKph, comfortableGustKph: Double
        }
        public struct RecentRides: Codable, Hashable, Sendable {
            public enum Mode: String, Codable, Sendable { case neutral, preferVariety = "prefer-variety" }
            public var mode: Mode
            public var lookbackDays: Int
        }
        public struct Climbing: Codable, Hashable, Sendable {
            public enum Preference: String, Codable, Sendable, CaseIterable { case flatter, neutral, hillier }
            public var preference: Preference
        }
        public struct Distance: Codable, Hashable, Sendable {
            public var minKm, maxKm: Double
            public init(minKm: Double, maxKm: Double) { self.minKm = minKm; self.maxKm = maxKm }
        }

        /// The deal-breakers. `nil` means no limit.
        public struct MinimumStandards: Codable, Hashable, Sendable {
            public var minimumTemperature: TemperatureFloor?
            public var maximumTemperatureC: Double?
            public var maximumGustKph: Double?
            public var maximumPrecipitationProbability: Double?

            /// Explicit nulls, because the API removes a limit only when it's sent as `null`.
            /// `maximumPrecipitationRateMmH` has no control, so it's never sent and stays as saved.
            public func encode(to encoder: any Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(minimumTemperature, forKey: .minimumTemperature)
                try container.encode(maximumTemperatureC, forKey: .maximumTemperatureC)
                try container.encode(maximumGustKph, forKey: .maximumGustKph)
                try container.encode(maximumPrecipitationProbability, forKey: .maximumPrecipitationProbability)
            }
        }

        /// `{kind: "fixed", valueC}` or `{kind: "monthly", valuesC: {"1"…"12": °C}, fallbackC}`.
        public struct TemperatureFloor: Codable, Hashable, Sendable {
            public var kind: String
            public var valueC: Double?
            public var valuesC: [String: Double]?
            public var fallbackC: Double?

            public static func fixed(_ c: Double) -> Self { .init(kind: "fixed", valueC: c) }

            /// The same limit in every month, for the rider to change month by month. The API has
            /// no seasonal offsets, so the app doesn't invent any.
            public static func monthly(_ c: Double) -> Self {
                .init(kind: "monthly", valuesC: Dictionary(uniqueKeysWithValues: (1...12).map { ("\($0)", c) }), fallbackC: nil)
            }

            public var isMonthly: Bool { kind == "monthly" }

            /// The limit in `month` (1–12). `nil` when a monthly policy has neither that month nor a
            /// fallback: the API leaves it unresolved, so there's no limit to show.
            public func valueC(in month: Int) -> Double? {
                isMonthly ? valuesC?["\(month)"] ?? fallbackC : valueC
            }
        }

        /// The API removes the distance preference only when it's sent as `null`.
        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(temperature, forKey: .temperature)
            try container.encode(wind, forKey: .wind)
            try container.encode(recentRides, forKey: .recentRides)
            try container.encode(climbing, forKey: .climbing)
            try container.encode(distance, forKey: .distance)
            try container.encode(minimumStandards, forKey: .minimumStandards)
        }
    }

    /// `settings.units`. Absent until the rider picks, so the device's region decides.
    public struct Units: Codable, Hashable, Sendable {
        public var temperature: String // "C" | "F"
        public var windSpeed: String // "kmh" | "mph"
        public init(temperature: String, windSpeed: String) { self.temperature = temperature; self.windSpeed = windSpeed }
    }

    /// `settings.display`: distances, independent of wind speed.
    public struct Display: Codable, Hashable, Sendable {
        public var unit: String // "km" | "mi"
        public init(unit: String) { self.unit = unit }
    }

    /// `preferenceLevels.sunshine`. The API reads weights it doesn't recognise as `custom`.
    public enum SunshineLevel: String, Codable, Sendable, CaseIterable {
        case dontMind = "dont-mind", nice, important, custom
    }

    /// `preferenceLevels.rain`.
    public enum RainLevel: String, Codable, Sendable, CaseIterable {
        case dontMind = "dont-mind", lightOK = "light-ok", avoid, custom
    }

    /// `preferenceLevels.crosswind` (API v0.25.0): sensitivity 0.5, 1 or 2; anything else is `custom`.
    public enum CrosswindLevel: String, Codable, Sendable, CaseIterable {
        case low, normal, high, custom
    }
}

public extension RiderSettings {
    /// The design's values, for the fixture world and previews.
    static let sample = RiderSettings(
        riding: .init(averageSpeedKph: 20, departureStepMinutes: 30),
        preferences: .init(
            temperature: .init(comfortMinC: 10, comfortMaxC: 22),
            wind: .init(comfortableHeadwindKph: 15, comfortableCrosswindKph: 20, comfortableGustKph: 35),
            recentRides: .init(mode: .preferVariety, lookbackDays: 28),
            climbing: .init(preference: .flatter),
            distance: .init(minKm: 40, maxKm: 80),
            minimumStandards: .init(minimumTemperature: .fixed(4), maximumTemperatureC: 30, maximumGustKph: 45, maximumPrecipitationProbability: 0.6)),
        sunshine: .nice, rain: .lightOK, crosswind: .normal)
}

/// The rider's saved settings, shared by the Preferences tab and Rides. Edits save as you go:
/// each change is sent with `PATCH /users/me` after a short pause, and `revision` moves on once
/// it's saved so Rides re-ranks.
@MainActor @Observable
public final class RiderSettingsStore {
    public enum Phase: Equatable { case loading, signedOut, loaded, failed(String) }

    public private(set) var phase: Phase
    public var settings: RiderSettings? {
        didSet { scheduleSave() }
    }
    /// Bumped after each save; Rides reloads when it changes.
    public private(set) var revision = 0
    /// The last board Rides loaded, for "How Your Routes Fit".
    public var board: RideBoard?
    /// "Signed in with Apple" details from `/auth/me`.
    public private(set) var email: String?
    /// Linked sign-in methods, oldest first: "apple", "google", "passkey". Not necessarily the
    /// one this session used.
    public private(set) var providers: [String] = []
    public private(set) var weatherProviderId: String?
    /// Strava's state for the Connections row. The API has no Strava connection yet, so live
    /// accounts leave it `nil` (docs/redesign/preferences-api-requests.md, item 1).
    public private(set) var strava: Strava?

    public struct Strava: Hashable, Sendable {
        public var lastSync: Date?
        public var averageSpeedKph: Double?
    }

    private let isLive: Bool
    private var version = 0
    private var saved: RiderSettings?
    private var saveTask: Task<Void, Never>?

    /// Live: loads from the API. Otherwise it holds `settings` and never touches the network.
    public init(live: Bool) {
        isLive = live
        phase = live ? .loading : .loaded
        if !live {
            saved = .sample
            settings = .sample
            board = .sample
            providers = ["apple"]
            strava = Strava(lastSync: Calendar.current.date(bySettingHour: 8, minute: 10, second: 0, of: .now), averageSpeedKph: 21.4)
        }
    }

    public func load() async {
        guard isLive else { return }
        guard let session = RideOnSession.shared.credentials?.id else { clearAccount(); return }
        do {
            async let user: UserResponse = RideOnAPI.send("/users/me")
            async let auth = try? (RideOnAPI.send("/auth/me") as AuthResponse)
            let response = try await user
            guard RideOnSession.shared.credentials?.id == session, !Task.isCancelled else { return }
            // An edit still waiting to save wins over what the server had.
            if settings == saved { apply(response) } else { version = response.user.version }
            let authentication = await auth
            guard RideOnSession.shared.credentials?.id == session, !Task.isCancelled else { return }
            email = authentication?.user.email
            providers = authentication?.user.providers ?? []
            phase = .loaded
        } catch let failure as RideOnAPI.Failure where failure.status == 401 {
            phase = .signedOut
        } catch is CancellationError {
        } catch where Task.isCancelled {
        } catch {
            if settings == nil { phase = .failed(error.localizedDescription) }
        }
    }

    public func signOut() {
        if isLive { RideOnAPI.signOut() }
        clearAccount()
        revision += 1
    }

    public func clearAccount() {
        saveTask?.cancel()
        saved = nil
        board = nil
        settings = nil
        email = nil
        providers = []
        weatherProviderId = nil
        strava = nil
        version = 0
        phase = .signedOut
    }

    private func apply(_ response: UserResponse) {
        let user = response.user
        version = user.version
        weatherProviderId = user.weatherProviderId
        let fresh = RiderSettings(riding: user.settings.riding, preferences: user.settings.preferences, units: user.settings.units,
                                  display: user.settings.display, sunshine: user.preferenceLevels?.sunshine ?? .custom,
                                  rain: user.preferenceLevels?.rain ?? .custom, crosswind: user.preferenceLevels?.crosswind)
        saved = fresh
        settings = fresh
    }

    private func scheduleSave() {
        guard isLive, let settings, settings != saved else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await save(settings)
        }
    }

    private func save(_ settings: RiderSettings) async {
        let session = RideOnSession.shared.credentials?.id
        do {
            let response: UserResponse
            do {
                response = try await RideOnAPI.send("/users/me", method: "PATCH", body: Patch(expectedVersion: version, settings))
            } catch let failure as RideOnAPI.Failure where failure.status == 409 {
                // ponytail: someone else saved first (the Ride Window sheet, the extension). Take their
                // version and send ours again: the rider is looking at these values, so they win.
                let current: UserResponse = try await RideOnAPI.send("/users/me")
                response = try await RideOnAPI.send("/users/me", method: "PATCH", body: Patch(expectedVersion: current.user.version, settings))
            }
            guard RideOnSession.shared.credentials?.id == session, !Task.isCancelled else { return }
            version = response.user.version
            saved = settings
            revision += 1
        } catch {
            // ponytail: a failed save stays on screen and goes with the next change; there's no retry banner.
        }
    }

    struct UserResponse: Decodable {
        struct User: Decodable {
            struct Settings: Decodable {
                var riding: RiderSettings.Riding
                var preferences: RiderSettings.Preferences
                var units: RiderSettings.Units?
                var display: RiderSettings.Display?
            }
            struct Levels: Codable {
                var sunshine: RiderSettings.SunshineLevel?
                var rain: RiderSettings.RainLevel?
                var crosswind: RiderSettings.CrosswindLevel?
            }
            var version: Int
            var settings: Settings
            var preferenceLevels: Levels?
            var weatherProviderId: String?
        }
        var user: User
    }

    struct AuthResponse: Decodable {
        struct User: Decodable { var email: String?; var providers: [String]? }
        var user: User
    }

    struct Patch: Encodable {
        struct Settings: Encodable {
            var riding: RiderSettings.Riding
            var preferences: RiderSettings.Preferences
            var units: RiderSettings.Units?
            var display: RiderSettings.Display?
            var preferenceLevels: UserResponse.User.Levels
        }
        var expectedVersion: Int
        var settings: Settings

        /// A `custom` level isn't sent, so weights set elsewhere survive. Nor is a missing crosswind
        /// level: an API older than v0.25.0 rejects the key.
        init(expectedVersion: Int, _ s: RiderSettings) {
            self.expectedVersion = expectedVersion
            settings = Settings(riding: s.riding, preferences: s.preferences, units: s.units, display: s.display,
                                preferenceLevels: .init(sunshine: s.sunshine == .custom ? nil : s.sunshine,
                                                        rain: s.rain == .custom ? nil : s.rain,
                                                        crosswind: s.crosswind == .custom ? nil : s.crosswind))
        }
    }
}

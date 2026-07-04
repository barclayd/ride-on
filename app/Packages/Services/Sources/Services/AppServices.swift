import SwiftUI

/// Simple DI container — no framework, just a struct of protocols injected
/// via `@Environment`. Swap `.fixtures` for `.live` once Phase 6 ships real
/// WeatherKit/MapKit/HealthKit/Strava implementations.
public struct AppServices: Sendable {
    public var weather: any WeatherProviding
    public var eta: any ETAProviding
    public var health: any HealthStoreProviding
    public var strava: any StravaClientProtocol
    public var classify: any ClassifyClient

    public init(
        weather: any WeatherProviding,
        eta: any ETAProviding,
        health: any HealthStoreProviding,
        strava: any StravaClientProtocol,
        classify: any ClassifyClient
    ) {
        self.weather = weather
        self.eta = eta
        self.health = health
        self.strava = strava
        self.classify = classify
    }

    public static let fixtures = AppServices(
        weather: FixtureWeatherProvider(),
        eta: FixtureETAProvider(),
        health: FixtureHealthStore(),
        strava: FixtureStravaClient(),
        classify: FixtureClassifyClient()
    )

    /// Phase 6: every service now has a real implementation. Health stays
    /// fixture-backed on macOS — HealthKit is iOS-only, Mac gets ride
    /// history via CloudKit sync of what iOS wrote (RideOn-macOS.entitlements).
    public static let live = AppServices(
        weather: LiveWeatherProvider(),
        eta: LiveETAProvider(),
        health: Self.liveHealthStore,
        strava: LiveStravaClient(),
        classify: LiveClassifyClient()
    )

    private static var liveHealthStore: any HealthStoreProviding {
        #if os(iOS)
        LiveHealthKitStore()
        #else
        FixtureHealthStore()
        #endif
    }
}

public extension EnvironmentValues {
    @Entry var services: AppServices = .fixtures
}

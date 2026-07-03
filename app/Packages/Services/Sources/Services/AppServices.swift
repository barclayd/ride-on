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

    /// Weather/ETA/health/Strava stay fixture-backed until Phase 6 — only
    /// `/classify` is deployed and live today (Phase 1), so it's the one
    /// service worth hitting for real out of fixture-world.
    public static let live = AppServices(
        weather: FixtureWeatherProvider(),
        eta: FixtureETAProvider(),
        health: FixtureHealthStore(),
        strava: FixtureStravaClient(),
        classify: LiveClassifyClient()
    )
}

public extension EnvironmentValues {
    @Entry var services: AppServices = .fixtures
}

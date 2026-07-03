import SwiftUI

/// Simple DI container — no framework, just a struct of protocols injected
/// via `@Environment`. Swap `.fixtures` for `.live` once Phase 6 ships real
/// WeatherKit/MapKit/HealthKit/Strava implementations.
struct AppServices {
    var weather: any WeatherProviding
    var eta: any ETAProviding
    var health: any HealthStoreProviding
    var strava: any StravaClientProtocol
    var classify: any ClassifyClient

    static let fixtures = AppServices(
        weather: FixtureWeatherProvider(),
        eta: FixtureETAProvider(),
        health: FixtureHealthStore(),
        strava: FixtureStravaClient(),
        classify: FixtureClassifyClient()
    )

    /// Weather/ETA/health/Strava stay fixture-backed until Phase 6 — only
    /// `/classify` is deployed and live today (Phase 1), so it's the one
    /// service worth hitting for real out of fixture-world.
    static let live = AppServices(
        weather: FixtureWeatherProvider(),
        eta: FixtureETAProvider(),
        health: FixtureHealthStore(),
        strava: FixtureStravaClient(),
        classify: LiveClassifyClient()
    )
}

extension EnvironmentValues {
    @Entry var services: AppServices = .fixtures
}

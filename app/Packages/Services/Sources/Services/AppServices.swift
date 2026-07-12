import SwiftUI

/// Simple DI container — no framework, just a struct of protocols injected
/// via `@Environment`. Swap `.fixtures` for `.live` once Phase 6 ships real
/// WeatherKit/MapKit/HealthKit/Strava implementations.
public struct AppServices: Sendable {
    public var weather: any WeatherProviding
    public var eta: any ETAProviding
    public var location: any LocationProviding
    public var health: any HealthStoreProviding
    public var strava: any StravaClientProtocol
    public var classify: any ClassifyClient
    public var elevation: any ElevationClient

    public init(
        weather: any WeatherProviding,
        eta: any ETAProviding,
        location: any LocationProviding,
        health: any HealthStoreProviding,
        strava: any StravaClientProtocol,
        classify: any ClassifyClient,
        elevation: any ElevationClient
    ) {
        self.weather = weather
        self.eta = eta
        self.location = location
        self.health = health
        self.strava = strava
        self.classify = classify
        self.elevation = elevation
    }

    public static let fixtures = AppServices(
        weather: FixtureWeatherProvider(),
        eta: FixtureETAProvider(),
        location: FixtureLocationProvider(),
        health: FixtureHealthStore(),
        strava: FixtureStravaClient(),
        classify: FixtureClassifyClient(),
        elevation: FixtureElevationClient()
    )

    /// Phase 6: every service now has a real implementation. Health stays
    /// fixture-backed on macOS — HealthKit is iOS-only, Mac gets ride
    /// history via CloudKit sync of what iOS wrote (RideOn-macOS.entitlements).
    public static let live = AppServices(
        weather: LiveWeatherProvider(),
        eta: LiveETAProvider(),
        location: LiveLocationProvider(),
        health: Self.liveHealthStore,
        strava: LiveStravaClient(),
        classify: LiveClassifyClient(),
        elevation: LiveOpenMeteoElevationClient()
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

import XCTest
import Services

/// Proves the DI container wires up and every fixture service is reachable
/// without touching a network or a real entitlement.
final class AppServicesTests: XCTestCase {
    func testFixtureServicesAreUsable() async throws {
        let services = AppServices.fixtures

        let forecast = try await services.weather.forecast(for: FixtureWorld.sampleLocation, on: .now)
        XCTAssertEqual(forecast.sky, .sunny)

        let eta = try await services.eta.travelTime(from: FixtureWorld.sampleLocation, to: FixtureWorld.sampleLocation)
        XCTAssertGreaterThan(eta, 0)

        let rides = try await services.health.recentCyclingRides(since: .distantPast)
        XCTAssertEqual(rides, [])

        let routes = try await services.strava.importedRoutes()
        XCTAssertEqual(routes.first?.name, FixtureWorld.sampleRoute.name)
    }
}

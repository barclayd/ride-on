import Foundation
import Testing
import Models
@testable import Engine

/// Direct, narrow unit tests for the Phase 3 factors not already exercised
/// end-to-end by `GoldenScenarioTests`.
@Suite("Weather + surface + intent factors")
struct FactorTests {
    private let fixedDate = Date(timeIntervalSince1970: 1_750_000_000)
    private let start = Coordinate(latitude: 51.0, longitude: -1.0)

    private func route(distanceKm: Double = 20, surfaces: SurfaceBreakdown? = nil) -> Route {
        Route(
            name: "Test Route",
            distanceKm: distanceKm,
            elevationGainM: 0,
            surfaces: surfaces ?? SurfaceBreakdown(distanceKmBySurface: [.paved: distanceKm]),
            suggestedBikeType: .road
        )
    }

    private func context(forecast: [HourlyWeather]) -> DailyContext {
        DailyContext(
            date: fixedDate, startLocation: start, hoursAvailable: 3,
            intent: .easy, bike: Bike(name: "Bike", type: .road), hourlyForecast: forecast
        )
    }

    private func hour(temp: Double = 16, wind: Double = 5, precip: Double = 0, cloud: Double = 0.3) -> HourlyWeather {
        HourlyWeather(time: fixedDate, temperatureC: temp, windSpeedKph: wind, windDirectionDegrees: 0, precipitationChance: precip, cloudCover: cloud)
    }

    @Test("temperature factor scores full marks inside the preferred range and falls off outside it")
    func temperatureFactor() {
        let factor = TemperatureFactor(preferences: RiderPreferences(preferredTempRangeC: 10...22))
        let inRange = factor.score(route: route(), context: context(forecast: [hour(temp: 16)]))
        let wayOutOfRange = factor.score(route: route(), context: context(forecast: [hour(temp: 35)]))
        #expect(inRange.value == 1.0)
        #expect(wayOutOfRange.value < inRange.value)
    }

    @Test("sky factor rewards clear sky for sun-seekers and cloud cover for sun-avoiders")
    func skyFactor() {
        let clearHour = hour(cloud: 0.05)
        let cloudyHour = hour(cloud: 0.95)

        let seeker = SkyFactor(preferences: RiderPreferences(sunPreference: .seek))
        #expect(seeker.score(route: route(), context: context(forecast: [clearHour])).value >
                 seeker.score(route: route(), context: context(forecast: [cloudyHour])).value)

        let avoider = SkyFactor(preferences: RiderPreferences(sunPreference: .avoid))
        #expect(avoider.score(route: route(), context: context(forecast: [cloudyHour])).value >
                 avoider.score(route: route(), context: context(forecast: [clearHour])).value)
    }

    @Test("rain factor penalizes chance of rain more for low-tolerance riders")
    func rainFactor() {
        let wetHour = hour(precip: 0.8)
        let lowTolerance = RainFactor(preferences: RiderPreferences(rainTolerance: 0))
        let highTolerance = RainFactor(preferences: RiderPreferences(rainTolerance: 1))

        let lowValue = lowTolerance.score(route: route(), context: context(forecast: [wetHour])).value
        let highValue = highTolerance.score(route: route(), context: context(forecast: [wetHour])).value

        #expect(lowValue < highValue)
        #expect(highValue == 1.0)
    }

    @Test("surface match factor penalizes a road bike on an unpaved-heavy route but not a gravel bike")
    func surfaceMatchFactor() {
        let unpavedRoute = route(distanceKm: 20, surfaces: SurfaceBreakdown(distanceKmBySurface: [.unpaved: 18, .paved: 2]))
        let factor = SurfaceMatchFactor()

        let roadContext = DailyContext(date: fixedDate, startLocation: start, hoursAvailable: 3, intent: .easy, bike: Bike(name: "Road", type: .road))
        let gravelContext = DailyContext(date: fixedDate, startLocation: start, hoursAvailable: 3, intent: .easy, bike: Bike(name: "Gravel", type: .gravel))

        let roadValue = factor.score(route: unpavedRoute, context: roadContext).value
        let gravelValue = factor.score(route: unpavedRoute, context: gravelContext).value

        #expect(roadValue < 0.5)
        #expect(gravelValue > 0.8)
    }
}

import Foundation
import Testing
import Models
@testable import Engine

@Suite("SpeedModelDerivation")
struct SpeedModelDerivationTests {
    private let defaults: [SurfaceType: Double] = [.paved: 24, .busyRoad: 22, .unpaved: 16, .path: 14]

    @Test("all-paved observations converge the paved speed and leave other surfaces at defaults")
    func allPavedObservation() {
        let observations: [(surfaceShare: [SurfaceType: Double], avgSpeedKph: Double)] = [
            (surfaceShare: [.paved: 1.0], avgSpeedKph: 28),
            (surfaceShare: [.paved: 1.0], avgSpeedKph: 30),
        ]
        let result = SpeedModelDerivation.deriveSpeeds(observations: observations, defaults: defaults)
        #expect(result[.paved] == 29)
        #expect(result[.unpaved] == defaults[.unpaved])
        #expect(result[.busyRoad] == defaults[.busyRoad])
        #expect(result[.path] == defaults[.path])
    }

    @Test("mixed-surface ride weights each surface's speed by its share of the ride")
    func mixedSurfaceWeighting() {
        // Ride 1: half paved half unpaved at 20 kph average.
        // Ride 2: all unpaved at 16 kph average.
        // Unpaved should end up weighted toward ride 2 (bigger unpaved share).
        let observations: [(surfaceShare: [SurfaceType: Double], avgSpeedKph: Double)] = [
            (surfaceShare: [.paved: 0.5, .unpaved: 0.5], avgSpeedKph: 20),
            (surfaceShare: [.unpaved: 1.0], avgSpeedKph: 16),
        ]
        let result = SpeedModelDerivation.deriveSpeeds(observations: observations, defaults: defaults)
        // paved: only ride 1 contributes -> 20
        #expect(result[.paved] == 20)
        // unpaved: (0.5*20 + 1.0*16) / 1.5 = 17.33...
        #expect(abs((result[.unpaved] ?? 0) - (26.0 / 1.5)) < 0.001)
    }

    @Test("no observations leaves every default untouched")
    func noObservationsKeepsDefaults() {
        let result = SpeedModelDerivation.deriveSpeeds(observations: [], defaults: defaults)
        #expect(result == defaults)
    }
}

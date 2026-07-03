import Testing
import Models
@testable import Engine

@Suite("SpeedModel")
struct SpeedModelTests {
    @Test("flat all-paved ride at a known speed takes the expected time")
    func flatPavedRide() {
        // 40km at 20kph, no climbing, no penalty -> exactly 2 hours.
        let seconds = SpeedModel.estimateRideTime(
            distanceKm: 40,
            elevationGainM: 0,
            surfaceShare: [.paved: 1.0],
            speedKphBySurface: [.paved: 20],
            climbingPenaltyMinutesPer100m: 0
        )
        #expect(seconds == 2 * 3600)
    }

    @Test("climbing penalty adds minutes proportional to gain")
    func climbingPenalty() {
        // 20km at 20kph = 1 hour flat, + 500m gain * 4min/100m = 20 minutes.
        let seconds = SpeedModel.estimateRideTime(
            distanceKm: 20,
            elevationGainM: 500,
            surfaceShare: [.paved: 1.0],
            speedKphBySurface: [.paved: 20],
            climbingPenaltyMinutesPer100m: 4
        )
        #expect(seconds == 1 * 3600 + 20 * 60)
    }

    @Test("mixed surfaces split time proportionally to distance share")
    func mixedSurfaces() {
        // 30km: half paved @ 30kph (0.5h), half unpaved @ 15kph (1h) -> 1.5h.
        let seconds = SpeedModel.estimateRideTime(
            distanceKm: 30,
            elevationGainM: 0,
            surfaceShare: [.paved: 0.5, .unpaved: 0.5],
            speedKphBySurface: [.paved: 30, .unpaved: 15],
            climbingPenaltyMinutesPer100m: 0
        )
        #expect(abs(seconds - 1.5 * 3600) < 0.001)
    }

    @Test("zero distance is zero time")
    func zeroDistance() {
        let seconds = SpeedModel.estimateRideTime(
            distanceKm: 0,
            elevationGainM: 0,
            surfaceShare: [.paved: 1.0],
            speedKphBySurface: [.paved: 20],
            climbingPenaltyMinutesPer100m: 4
        )
        #expect(seconds == 0)
    }
}

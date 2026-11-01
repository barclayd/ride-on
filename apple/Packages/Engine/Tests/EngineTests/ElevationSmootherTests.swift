import Testing
@testable import Engine

@Suite("ElevationSmoother")
struct ElevationSmootherTests {
    @Test("moving average smooths a single spike")
    func movingAverageSmoothsSpike() {
        let raw = [100.0, 100.0, 150.0, 100.0, 100.0]
        let smoothed = ElevationSmoother.movingAverage(raw, windowSize: 5)
        // The spike should be pulled well below its raw 150 value.
        #expect(smoothed[2] < 150)
        #expect(smoothed[2] > 100)
    }

    @Test("total gain on a clean monotonic climb equals the rise")
    func gainOnCleanClimb() {
        let elevations = [0.0, 10.0, 20.0, 30.0]
        #expect(ElevationSmoother.totalGain(elevations, minDeltaM: 2) == 30)
    }

    @Test("sub-threshold jitter contributes no gain")
    func jitterBelowThresholdIsIgnored() {
        // Wobbles up and down within 0.7m, never clearing the 2m threshold in
        // either direction -> zero recorded gain.
        let elevations = [100.0, 100.5, 100.2, 100.7, 100.3, 100.6]
        #expect(ElevationSmoother.totalGain(elevations, minDeltaM: 2) == 0)
    }

    @Test("descent then climb only counts the net climb from the new base")
    func descentResetsBase() {
        // 100 -> 90 (descend, resets base to 90) -> 105 (climb 15 from base).
        let elevations = [100.0, 90.0, 105.0]
        #expect(ElevationSmoother.totalGain(elevations, minDeltaM: 2) == 15)
    }

    @Test("known-answer fixture: out-and-back over one hill")
    func outAndBackOverOneHill() {
        // Up 50m, back down to start: total gain should be 50, not 100.
        let elevations = [0.0, 10.0, 25.0, 50.0, 25.0, 10.0, 0.0]
        #expect(ElevationSmoother.totalGain(elevations, minDeltaM: 2) == 50)
    }
}

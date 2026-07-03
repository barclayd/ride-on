import Foundation

/// Turns noisy raw GPX elevation samples into a usable total gain figure:
/// moving average to knock down GPS jitter, then a min-delta threshold so
/// sub-threshold wobble doesn't accumulate as fake climbing.
public enum ElevationSmoother {
    public static func movingAverage(_ elevations: [Double], windowSize: Int = 5) -> [Double] {
        guard windowSize > 1, elevations.count > 1 else { return elevations }
        let half = windowSize / 2
        return elevations.indices.map { i in
            let lower = max(0, i - half)
            let upper = min(elevations.count - 1, i + half)
            let window = elevations[lower...upper]
            return window.reduce(0, +) / Double(window.count)
        }
    }

    /// Cumulative elevation gain, ignoring any rise/fall smaller than `minDeltaM`.
    public static func totalGain(_ elevations: [Double], minDeltaM: Double = 2.0) -> Double {
        guard elevations.count > 1 else { return 0 }
        var gain = 0.0
        var base = elevations[0]
        for elevation in elevations.dropFirst() {
            if elevation - base >= minDeltaM {
                gain += elevation - base
                base = elevation
            } else if elevation < base {
                base = elevation
            }
        }
        return gain
    }

    /// Convenience: smooth then compute gain in one call.
    public static func smoothedGain(
        rawElevations: [Double],
        windowSize: Int = 5,
        minDeltaM: Double = 2.0
    ) -> Double {
        totalGain(movingAverage(rawElevations, windowSize: windowSize), minDeltaM: minDeltaM)
    }
}

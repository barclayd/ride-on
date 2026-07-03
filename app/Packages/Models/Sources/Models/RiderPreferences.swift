import Foundation

public enum SunPreference: String, Codable, CaseIterable, Sendable {
    case avoid
    case neutral
    case seek
}

public struct RiderPreferences: Codable, Sendable, Hashable {
    /// Comfortable riding temperature range, in Celsius.
    public var preferredTempRangeC: ClosedRange<Double>
    public var sunPreference: SunPreference
    /// 0 = no rain ever, 1 = doesn't care.
    public var rainTolerance: Double
    public var maxWindKph: Double
    /// 0 = always ride favourites, 1 = always seek something new.
    public var noveltyDial: Double
    /// Cruising speed in km/h per surface, used by `SpeedModel`.
    public var speedKphBySurface: [SurfaceType: Double]
    /// Extra minutes added per 100m of elevation gain.
    public var climbingPenaltyMinutesPer100m: Double

    public init(
        preferredTempRangeC: ClosedRange<Double> = 10...22,
        sunPreference: SunPreference = .neutral,
        rainTolerance: Double = 0.3,
        maxWindKph: Double = 30,
        noveltyDial: Double = 0.5,
        speedKphBySurface: [SurfaceType: Double] = [
            .paved: 24, .busyRoad: 22, .unpaved: 16, .path: 14
        ],
        climbingPenaltyMinutesPer100m: Double = 4
    ) {
        self.preferredTempRangeC = preferredTempRangeC
        self.sunPreference = sunPreference
        self.rainTolerance = rainTolerance
        self.maxWindKph = maxWindKph
        self.noveltyDial = noveltyDial
        self.speedKphBySurface = speedKphBySurface
        self.climbingPenaltyMinutesPer100m = climbingPenaltyMinutesPer100m
    }
}

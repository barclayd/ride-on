import Foundation

/// One hour of forecast, plain values only (no WeatherKit types — Engine
/// stays platform-free). `DailyContext.hourlyForecast` carries a run of
/// these; factors slice out whichever hours the predicted ride window
/// actually covers (Phase 3 time-window weather scoring).
public struct HourlyWeather: Codable, Sendable, Hashable {
    public var time: Date
    public var temperatureC: Double
    public var windSpeedKph: Double
    /// Meteorological convention: the direction the wind is blowing *from*.
    public var windDirectionDegrees: Double
    /// 0...1 probability of precipitation during this hour.
    public var precipitationChance: Double
    /// 0...1 fraction of sky covered by cloud.
    public var cloudCover: Double

    public init(
        time: Date,
        temperatureC: Double,
        windSpeedKph: Double,
        windDirectionDegrees: Double,
        precipitationChance: Double,
        cloudCover: Double
    ) {
        self.time = time
        self.temperatureC = temperatureC
        self.windSpeedKph = windSpeedKph
        self.windDirectionDegrees = windDirectionDegrees
        self.precipitationChance = precipitationChance
        self.cloudCover = cloudCover
    }
}

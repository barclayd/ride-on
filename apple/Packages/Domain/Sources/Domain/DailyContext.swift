import Foundation

public enum RideIntent: String, Codable, CaseIterable, Sendable {
    case easy
    case training
    case exploring
}

/// Everything the scorer needs to know about "today" — how much time is
/// available, where the rider starts, and what kind of ride they're after.
public struct DailyContext: Codable, Sendable, Hashable {
    public var date: Date
    public var startLocation: Coordinate
    public var hoursAvailable: Double
    /// Wall-clock time the rider needs to be back by, if any.
    public var backBy: Date?
    public var intent: RideIntent
    public var bike: Bike
    /// Hourly forecast covering (at least) the predicted ride window, used by
    /// the weather factors (wind/temperature/sky/rain) for time-window
    /// scoring rather than a whole-day average.
    public var hourlyForecast: [HourlyWeather]

    public init(
        date: Date,
        startLocation: Coordinate,
        hoursAvailable: Double,
        backBy: Date? = nil,
        intent: RideIntent,
        bike: Bike,
        hourlyForecast: [HourlyWeather] = []
    ) {
        self.date = date
        self.startLocation = startLocation
        self.hoursAvailable = hoursAvailable
        self.backBy = backBy
        self.intent = intent
        self.bike = bike
        self.hourlyForecast = hourlyForecast
    }
}

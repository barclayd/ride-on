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

    public init(
        date: Date,
        startLocation: Coordinate,
        hoursAvailable: Double,
        backBy: Date? = nil,
        intent: RideIntent,
        bike: Bike
    ) {
        self.date = date
        self.startLocation = startLocation
        self.hoursAvailable = hoursAvailable
        self.backBy = backBy
        self.intent = intent
        self.bike = bike
    }
}

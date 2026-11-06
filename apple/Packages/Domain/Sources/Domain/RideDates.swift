import Foundation

/// Ride clocks use an IANA zone, so daylight saving follows the date of the ride.
/// Older saved UK boards predate explicit zones; never fall back to the device's zone.
public enum RideDates {
    public static let defaultTimeZone = TimeZone(identifier: "Europe/London")!

    public static func timeZone(_ identifier: String?) -> TimeZone {
        identifier.flatMap(TimeZone.init(identifier:)) ?? defaultTimeZone
    }

    public static func calendar(in timeZone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }
}

public extension Date {
    func formatted(_ style: Date.FormatStyle, in timeZone: TimeZone) -> String {
        var style = style
        style.timeZone = timeZone
        style.calendar.timeZone = timeZone
        return formatted(style)
    }
}

public extension RideBoard {
    var rideTimeZone: TimeZone { RideDates.timeZone(timeZone) }
    var calendar: Calendar { RideDates.calendar(in: rideTimeZone) }
}

public extension RideBoard.Pick {
    var rideTimeZone: TimeZone { RideDates.timeZone(timeZone) }
    var calendar: Calendar { RideDates.calendar(in: rideTimeZone) }
}

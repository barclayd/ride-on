import Foundation

/// What the widget, its Lock Screen and Control Centre forms and the Live Activity show
/// (docs/redesign/README.md §8): each window day's best ride, and the tracked ride. The app saves it
/// to the App Group whenever either changes; the widget extension only reads it.
public struct RideWidgetSnapshot: Codable, Sendable, Equatable {
    /// When the board was ranked: "Updated 09:31".
    public var generatedAt: Date
    public var days: [Day]
    /// The day of the window's best ride, where paging starts.
    public var bestDay: Date?
    public var tracked: Tracked?
    public var units: Units

    public struct Day: Codable, Sendable, Equatable {
        public var date: Date
        public var ride: Ride?
        /// Why there's no ride: "Rain from dawn to dusk".
        public var note: String?
    }

    /// One route at one departure, as the widget draws it.
    public struct Ride: Codable, Sendable, Hashable {
        /// `RideBoard.Pick.id`.
        public var id: String
        public var name: String
        public var distanceKm: Double
        public var ascentM: Double
        public var start: Date
        public var finish: Date
        public var score: Int
        public var meetsMinimums: Bool
        public var temperatureC: ClosedRange<Double>
        public var windKph: Double
        public var wind: RideBoard.Wind
        public var gustKph: Double
        public var sky: RideBoard.Sky
        /// The route, thinned for drawing.
        public var loop: [Coordinate]
        /// One per hour from the start: "Along the ride".
        public var hours: [Hour]
    }

    public struct Hour: Codable, Sendable, Hashable {
        public var time: Date
        public var sky: RideBoard.Sky
        public var temperatureC: Double
        public var windKph: Double
    }

    public struct Tracked: Codable, Sendable, Hashable {
        public var ride: Ride
        /// The latest check's score, or the score when tracking started.
        public var score: Int
        /// `score` less the score when tracking started.
        public var change: Int
        /// The conditions that now fail a minimum.
        public var warnings: Set<Warning>
        public var check: Check
        /// "Checked 07:02".
        public var checkedAt: Date?
    }

    public enum Warning: String, Codable, Sendable { case wind, cold, heat, rain }

    /// What the latest forecast check found, most important first.
    public enum Check: String, Codable, Sendable {
        case unchanged, changed, betterRide, checking, due, failed, closed
    }

    /// The rider's display units, as the app shows them.
    public struct Units: Codable, Sendable, Hashable {
        public var distance: UnitSystem
        public var speed: UnitSystem
        /// `nil` follows the locale.
        public var temperature: TemperatureUnit?

        public init(distance: UnitSystem, speed: UnitSystem, temperature: TemperatureUnit?) {
            self.distance = distance
            self.speed = speed
            self.temperature = temperature
        }
    }
}

extension RideBoard.Wind: Codable {}
extension RideBoard.Sky: Codable {}

public extension RideWidgetSnapshot {
    /// `previous` keeps a tracked ride the board has moved past showing until it's over.
    init(board: RideBoard, tracked: TrackedRide?, units: Units, previous: RideWidgetSnapshot? = nil) {
        generatedAt = board.generatedAt
        self.units = units
        let best = board.picks.first
        bestDay = (board.days.first { $0.best?.id == best?.id } ?? board.days.first { $0.best != nil })?.date
        days = board.days.map { Day(date: $0.date, ride: $0.best.map { Ride($0, on: board) }, note: $0.note) }
        self.tracked = tracked.flatMap { tracked in
            guard let pick = (board.picks + board.days.compactMap(\.best)).first(where: { $0.id == tracked.pickID }) else {
                return previous?.tracked?.ride.id == tracked.pickID ? previous?.tracked : nil
            }
            return Tracked(tracked, ride: Ride(pick, on: board))
        }
    }

    /// The ride the widget is about: the tracked one until two hours after it ends, else the day's best.
    func trackedRide(at date: Date) -> Tracked? {
        tracked.flatMap { date < $0.ride.finish.addingTimeInterval(2 * 3600) ? $0 : nil }
    }

    /// The window's days from `date`'s on: past days drop off the widget.
    func days(from date: Date, calendar: Calendar = .current) -> [Day] {
        let today = calendar.startOfDay(for: date)
        return days.filter { $0.date >= today }
    }

    /// The day the widget shows: the one paged to, else the best ride's, else the first left.
    func day(at date: Date, paged: Date?, calendar: Calendar = .current) -> Day? {
        let days = days(from: date, calendar: calendar)
        return days.first { $0.date == paged } ?? days.first { $0.date == bestDay } ?? days.first
    }
}

extension RideWidgetSnapshot.Ride {
    init(_ pick: RideBoard.Pick, on board: RideBoard) {
        let detail = board.details[pick.id] ?? .sample(for: pick, on: board)
        let coordinates = pick.route.coordinates
        // ponytail: every nth point, not a curve-aware simplification; 120 keeps a loop's shape at widget size.
        let step = max(1, coordinates.count / 120)
        self.init(id: pick.id, name: pick.route.name, distanceKm: pick.route.distanceKm, ascentM: pick.route.ascentM,
                  start: pick.start, finish: pick.finish, score: pick.score, meetsMinimums: pick.meetsMinimums,
                  temperatureC: pick.conditions.temperatureC, windKph: pick.conditions.windKph, wind: pick.conditions.wind,
                  gustKph: pick.conditions.gustKph, sky: pick.conditions.sky,
                  loop: stride(from: 0, to: coordinates.count, by: step).map { coordinates[$0] },
                  hours: (detail.departures.first?.hours ?? []).map {
                      RideWidgetSnapshot.Hour(time: $0.time, sky: $0.sky, temperatureC: $0.temperatureC, windKph: $0.windKph)
                  })
    }
}

extension RideWidgetSnapshot.Tracked {
    init(_ tracked: TrackedRide, ride: RideWidgetSnapshot.Ride) {
        let score = tracked.latestScore ?? tracked.originalScore
        var warnings = Set<RideWidgetSnapshot.Warning>()
        var betterRide = false
        let check: RideWidgetSnapshot.Check
        switch tracked.check {
        case .checking: check = .checking
        case .due: check = .due
        case .failed: check = .failed
        case .closed: check = .closed
        case .checked(_, let changes):
            for change in changes {
                switch change {
                case .standard(.gust, _, _): warnings.insert(.wind)
                case .standard(.cold, _, _): warnings.insert(.cold)
                case .standard(.heat, _, _): warnings.insert(.heat)
                case .standard(.rainChance, _, _), .standard(.rainRate, _, _), .rain: warnings.insert(.rain)
                case .betterRoute, .betterTime: betterRide = true
                case .score, .incomplete: break
                }
            }
            check = !warnings.isEmpty ? .changed : betterRide ? .betterRide : .unchanged
        }
        self.init(ride: ride, score: score, change: score - tracked.originalScore, warnings: warnings, check: check,
                  checkedAt: tracked.check.lastChecked)
    }
}

public extension RideWidgetSnapshot.Ride {
    /// "~3h", "~2h 30m", "~45m": the ride's length to the nearest quarter hour.
    var duration: String {
        "~" + Self.hoursMinutes(max(1, Int((finish.timeIntervalSince(start) / 900).rounded())) * 15)
    }

    /// When the ride is, for where it's got to (docs/redesign/README.md §8): "Wed 09:00 · ~3h ride"
    /// before the day, "09:00 → ~12:00 · ~3h ride" on the morning, "1h 40m to go · back ~12:00" while
    /// riding, "Ride over" after. `short` fits a small widget's chip.
    func rideTime(at now: Date, short: Bool = false, calendar: Calendar = .current, locale: Locale = .current) -> String {
        let clock = { (date: Date) in date.formatted(Self.clock(calendar: calendar, locale: locale)) }
        if now >= finish { return "Ride over" }
        if now >= start {
            let left = Self.hoursMinutes(Int((finish.timeIntervalSince(now) / 60).rounded(.up)))
            return short ? "\(left) to go" : "\(left) to go · back ~\(clock(finish))"
        }
        if calendar.isDate(start, inSameDayAs: now) {
            return short ? "\(clock(start)) · \(duration) ride" : "\(clock(start)) → ~\(clock(finish)) · \(duration) ride"
        }
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now).map { calendar.isDate(start, inSameDayAs: $0) } ?? false
        let day = tomorrow ? (short ? "Tmrw" : "Tomorrow")
            : start.formatted(Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone).weekday(.abbreviated))
        return "\(day) \(clock(start)) · \(duration)\(short ? "" : " ride")"
    }

    /// "09:00", or "9:00 AM" where the locale says.
    static func clock(calendar: Calendar = .current, locale: Locale = .current) -> Date.FormatStyle {
        Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
            .hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits)
    }

    /// "1h 40m", "2h", "45m".
    static func hoursMinutes(_ minutes: Int) -> String {
        switch (minutes / 60, minutes % 60) {
        case (0, let m): "\(m)m"
        case (let h, 0): "\(h)h"
        case (let h, let m): "\(h)h \(m)m"
        }
    }
}

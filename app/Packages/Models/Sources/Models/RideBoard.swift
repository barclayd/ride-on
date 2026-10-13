import Foundation

/// Everything the Rides screen shows for one ride window: the window ranking,
/// each day's best ride and the routes that can't fit. Presentation values
/// only — the rebuilt UI renders `.sample` until it's wired to
/// `POST /recommendations` (docs/redesign/README.md, "Wiring notes").
public struct RideBoard: Hashable, Sendable {
    public var window: DateInterval
    public var generatedAt: Date
    /// Every route that fits the window at its best departure, best first.
    public var picks: [Pick]
    /// One entry per day in the window, in order.
    public var days: [Day]
    /// Routes too long for the window.
    public var unfit: [Unfit]

    public init(window: DateInterval, generatedAt: Date, picks: [Pick], days: [Day], unfit: [Unfit]) {
        self.window = window
        self.generatedAt = generatedAt
        self.picks = picks
        self.days = days
        self.unfit = unfit
    }
}

public extension RideBoard {
    struct RouteSummary: Hashable, Sendable, Identifiable {
        public var id: UUID
        public var name: String
        public var distanceKm: Double
        public var ascentM: Double
        public var coordinates: [Coordinate]

        public init(id: UUID = UUID(), name: String, distanceKm: Double, ascentM: Double, coordinates: [Coordinate]) {
            self.id = id
            self.name = name
            self.distanceKm = distanceKm
            self.ascentM = ascentM
            self.coordinates = coordinates
        }
    }

    /// One route at one departure.
    struct Pick: Hashable, Sendable, Identifiable {
        public var route: RouteSummary
        public var start: Date
        public var finish: Date
        /// 0–100.
        public var score: Int
        public var conditions: Conditions
        public var meetsMinimums: Bool
        public var lastRidden: Date?
        /// Score change since the previous forecast, if it moved.
        public var change: Int?

        public var id: String { "\(route.id)@\(start.timeIntervalSinceReferenceDate)" }

        public init(route: RouteSummary, start: Date, finish: Date, score: Int, conditions: Conditions, meetsMinimums: Bool = true, lastRidden: Date? = nil, change: Int? = nil) {
            self.route = route
            self.start = start
            self.finish = finish
            self.score = score
            self.conditions = conditions
            self.meetsMinimums = meetsMinimums
            self.lastRidden = lastRidden
            self.change = change
        }
    }

    struct Conditions: Hashable, Sendable {
        public var temperatureC: ClosedRange<Double>
        public var windKph: Double
        /// Mostly-felt wind direction relative to the route.
        public var wind: Wind
        public var gustKph: Double
        public var sky: Sky

        public init(temperatureC: ClosedRange<Double>, windKph: Double, wind: Wind, gustKph: Double, sky: Sky) {
            self.temperatureC = temperatureC
            self.windKph = windKph
            self.wind = wind
            self.gustKph = gustKph
            self.sky = sky
        }
    }

    enum Wind: String, Hashable, Sendable { case tailwind, crosswind, headwind }
    enum Sky: String, Hashable, Sendable { case sunny, sunnySpells, cloudy, rain }

    struct Day: Hashable, Sendable, Identifiable {
        public var date: Date
        /// `nil` when nothing is rideable that day.
        public var best: Pick?
        /// The day's overall sky, for days without a ride.
        public var sky: Sky

        public var id: Date { date }

        public init(date: Date, best: Pick?, sky: Sky) {
            self.date = date
            self.best = best
            self.sky = sky
        }
    }

    struct Unfit: Hashable, Sendable, Identifiable {
        public var route: RouteSummary
        public var rideDuration: TimeInterval
        public var windowAllows: TimeInterval

        public var id: UUID { route.id }

        public init(route: RouteSummary, rideDuration: TimeInterval, windowAllows: TimeInterval) {
            self.route = route
            self.rideDuration = rideDuration
            self.windowAllows = windowAllows
        }
    }
}

// MARK: - Sample

public extension RideBoard {
    /// Tuesday 13 October 2026, window Wed 14 – Sun 18 October (docs/redesign/README.md, "Sample data").
    static let sample: RideBoard = {
        let hilly = RouteSummary(name: "Hilly Loop", distanceKm: 51, ascentM: 640,
                                 coordinates: loop(center: Coordinate(latitude: 51.79, longitude: -0.66), distanceKm: 51, seed: 0.4))
        let potters = RouteSummary(name: "Potters Bar", distanceKm: 77, ascentM: 410,
                                   coordinates: loop(center: Coordinate(latitude: 51.698, longitude: -0.181), distanceKm: 77, seed: 1.7))
        let braintree = RouteSummary(name: "Braintree", distanceKm: 51, ascentM: 280,
                                     coordinates: loop(center: Coordinate(latitude: 51.878, longitude: 0.553), distanceKm: 51, seed: 2.9))
        let eastAnglia = RouteSummary(name: "East Anglia", distanceKm: 112, ascentM: 520,
                                      coordinates: loop(center: Coordinate(latitude: 52.2, longitude: 0.9), distanceKm: 112, seed: 4.2))

        let wednesday = Pick(route: hilly, start: date(14, 9), finish: date(14, 12), score: 86,
                             conditions: Conditions(temperatureC: 9...14, windKph: 15, wind: .tailwind, gustKph: 28, sky: .sunnySpells),
                             lastRidden: date(29, 8, month: 9), change: 4)
        let thursday = Pick(route: potters, start: date(15, 9), finish: date(15, 13, 20), score: 79,
                            conditions: Conditions(temperatureC: 12...14, windKph: 18, wind: .crosswind, gustKph: 31, sky: .cloudy),
                            lastRidden: date(4, 8, month: 10))
        let braintreeBest = Pick(route: braintree, start: date(14, 9, 30), finish: date(14, 12, 30), score: 61,
                                 conditions: Conditions(temperatureC: 10...14, windKph: 26, wind: .headwind, gustKph: 48, sky: .cloudy),
                                 meetsMinimums: false)
        let saturday = Pick(route: hilly, start: date(17, 10), finish: date(17, 13), score: 64,
                            conditions: Conditions(temperatureC: 8...11, windKph: 20, wind: .crosswind, gustKph: 34, sky: .cloudy),
                            lastRidden: date(29, 8, month: 9))
        let sunday = Pick(route: potters, start: date(18, 9, 30), finish: date(18, 13, 50), score: 71,
                          conditions: Conditions(temperatureC: 10...13, windKph: 12, wind: .tailwind, gustKph: 25, sky: .sunnySpells),
                          lastRidden: date(4, 8, month: 10))

        return RideBoard(
            window: DateInterval(start: date(14, 0), end: date(19, 0)),
            generatedAt: date(13, 8, 12),
            picks: [wednesday, thursday, braintreeBest],
            days: [
                Day(date: date(14, 0), best: wednesday, sky: .sunnySpells),
                Day(date: date(15, 0), best: thursday, sky: .cloudy),
                Day(date: date(16, 0), best: nil, sky: .rain),
                Day(date: date(17, 0), best: saturday, sky: .cloudy),
                Day(date: date(18, 0), best: sunday, sky: .sunnySpells),
            ],
            unfit: [Unfit(route: eastAnglia, rideDuration: 7 * 3600 + 5 * 60, windowAllows: 5 * 3600 + 45 * 60)]
        )
    }()

    private static func date(_ day: Int, _ hour: Int, _ minute: Int = 0, month: Int = 10) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    /// A wobbly closed loop about `distanceKm` round, starting and ending on its east side.
    private static func loop(center: Coordinate, distanceKm: Double, seed: Double) -> [Coordinate] {
        let radiusKm = distanceKm / (2 * .pi) * 0.9
        return (0...120).map { step in
            let angle = Double(step) / 120 * 2 * .pi
            let r = radiusKm * (1 + 0.22 * sin(3 * angle + seed) + 0.1 * cos(5 * angle + 2 * seed))
            let latitude = center.latitude + r / 111 * sin(angle)
            let longitude = center.longitude + r / (111 * cos(center.latitude * .pi / 180)) * cos(angle)
            return Coordinate(latitude: latitude, longitude: longitude)
        }
    }
}

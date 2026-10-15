import Foundation

/// Everything the Rides screen shows for one ride window: the window ranking,
/// each day's best ride and the routes that can't fit. Presentation values
/// only: `Services.RideBoardLoader` builds it from `POST /recommendations`;
/// previews and the fixture world use `.sample`.
public struct RideBoard: Hashable, Sendable {
    public var window: DateInterval
    public var generatedAt: Date
    /// Every route that fits the window at its best departure, best first.
    public var picks: [Pick]
    /// One entry per day in the window, in order.
    public var days: [Day]
    /// Today and the six days after it, chosen or not, for the Ride Window sheet.
    public var forecast: [Day]
    /// The hours each day's ride must fit in.
    public var hours: RideWindow.Hours
    /// Routes too long for the window.
    public var unfit: [Unfit]
    /// Ride detail per `Pick.id`; missing ones fall back to `RideDetail.sample`.
    public var details: [String: RideDetail]
    /// The forecast provider's required attribution; empty means Apple Weather.
    public var credits: [Credit]
    /// The comfort settings this ranking was scored with. Its `Pick.pointsLost` only describe
    /// edited preferences once these match them again; `nil` when the API doesn't say.
    public var scoredWith: Comfort?

    public init(window: DateInterval, generatedAt: Date, picks: [Pick], days: [Day], forecast: [Day] = [], hours: RideWindow.Hours = .daylight,
                unfit: [Unfit], details: [String: RideDetail] = [:], credits: [Credit] = [], scoredWith: Comfort? = nil) {
        self.window = window
        self.generatedAt = generatedAt
        self.picks = picks
        self.days = days
        self.forecast = forecast
        self.hours = hours
        self.unfit = unfit
        self.details = details
        self.credits = credits
        self.scoredWith = scoredWith
    }
}

public extension RideBoard {
    /// The API's `resolvedPreferences`, as far as the Preferences explanations need them.
    struct Comfort: Hashable, Sendable {
        public var temperatureC: ClosedRange<Double>
        public var headwindKph: Double
        public var crosswindKph: Double

        public init(temperatureC: ClosedRange<Double>, headwindKph: Double, crosswindKph: Double) {
            self.temperatureC = temperatureC
            self.headwindKph = headwindKph
            self.crosswindKph = crosswindKph
        }
    }
}

public extension RideBoard {
    /// "Powered by Met Office data", linking to the provider.
    struct Credit: Hashable, Sendable {
        public var text: String
        public var url: URL

        public init(text: String, url: URL) {
            self.text = text
            self.url = url
        }
    }
}

public extension RideBoard {
    struct RouteSummary: Hashable, Sendable, Identifiable {
        public var id: UUID
        public var name: String
        public var distanceKm: Double
        public var ascentM: Double
        public var coordinates: [Coordinate]
        /// The saved journey this route came from: `https://cycle.travel/map/journey/{source.externalId}`.
        public var cycleTravelURL: URL?

        public init(id: UUID = UUID(), name: String, distanceKm: Double, ascentM: Double, coordinates: [Coordinate], cycleTravelURL: URL? = nil) {
            self.id = id
            self.name = name
            self.distanceKm = distanceKm
            self.ascentM = ascentM
            self.coordinates = coordinates
            self.cycleTravelURL = cycleTravelURL
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
        /// How many points the score could gain if one factor were ideal (API `pointsLost`), keyed
        /// `temperature`, `wind`, `dryness`, `clearSkies`, `sunshine`, `climbing`, `distance`. A
        /// missing key is inactive or unknown, so makes no claim. Not additive.
        public var pointsLost: [String: Double]

        public var id: String { "\(route.id)@\(start.timeIntervalSinceReferenceDate)" }

        /// `pointsLost[factor]` in words, where `factor` is also the word ("temperature", "wind").
        /// `nil` makes no claim: zero costs nothing, and a missing value can't say.
        public func gainSentence(_ factor: String) -> String? {
            guard let points = pointsLost[factor], points > 0 else { return nil }
            guard points >= 1 else { return "The \(factor) has a small effect on its score." }
            let gain = Int(points.rounded())
            return "It could gain \(gain) \(gain == 1 ? "point" : "points") if the \(factor) were ideal."
        }

        public init(route: RouteSummary, start: Date, finish: Date, score: Int, conditions: Conditions, meetsMinimums: Bool = true, lastRidden: Date? = nil, change: Int? = nil,
                    pointsLost: [String: Double] = [:]) {
            self.route = route
            self.start = start
            self.finish = finish
            self.score = score
            self.conditions = conditions
            self.meetsMinimums = meetsMinimums
            self.lastRidden = lastRidden
            self.change = change
            self.pointsLost = pointsLost
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
        /// The best ride's warmest point.
        public var temperatureMaxC: Double?
        /// Why there's no ride, or what's missing: "Not forecast yet".
        public var note: String?
        /// When the forecast stops covering the day's hours.
        public var forecastEnds: Date?
        public var daylight: DateInterval?

        public var id: Date { date }

        public init(date: Date, best: Pick?, sky: Sky, temperatureMaxC: Double? = nil, note: String? = nil,
                    forecastEnds: Date? = nil, daylight: DateInterval? = nil) {
            self.date = date
            self.best = best
            self.sky = sky
            self.temperatureMaxC = temperatureMaxC
            self.note = note
            self.forecastEnds = forecastEnds
            self.daylight = daylight
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

/// What the Ride Window sheet chooses: the days to rank and the hours to ride in.
public struct RideWindow: Hashable, Sendable {
    /// The start of each chosen day, ascending.
    public var days: [Date]
    /// Set when `days` are exactly a quick pick, so the saved window moves on with the calendar.
    public var quickPick: QuickPick?
    public var hours: Hours

    public init(days: [Date], quickPick: QuickPick? = nil, hours: Hours) {
        self.days = days
        self.quickPick = quickPick
        self.hours = hours
    }

    public enum Hours: Hashable, Sendable {
        case daylight
        /// Minutes after midnight.
        case custom(leave: Int, back: Int)
    }

    /// The API's day presets (docs/planning-api.md), resolved as the extension resolves them.
    public enum QuickPick: String, CaseIterable, Sendable {
        case today, tomorrow, weekend, next

        /// "Next 5 Days" starts tomorrow; "This Weekend" is the coming Saturday and Sunday, or
        /// Sunday alone on a Sunday.
        public func days(from today: Date, calendar: Calendar = .current) -> [Date] {
            let today = calendar.startOfDay(for: today)
            func day(_ offset: Int) -> Date { calendar.date(byAdding: .day, value: offset, to: today)! }
            switch self {
            case .today: return [today]
            case .tomorrow: return [day(1)]
            case .next: return (1...5).map(day)
            case .weekend:
                let weekday = calendar.component(.weekday, from: today) // 1 is Sunday, 7 Saturday
                return weekday == 1 ? [today] : [day(7 - weekday), day(8 - weekday)]
            }
        }
    }
}

public extension RideBoard.Sky {
    var title: String {
        switch self {
        case .sunny: "Sunny"
        case .sunnySpells: "Sunny spells"
        case .cloudy: "Cloudy"
        case .rain: "Rain"
        }
    }
}

public extension RideBoard.Wind {
    /// Sentence case: "Tailwind".
    var title: String { rawValue.capitalized }
}

// MARK: - Sample

public extension RideBoard {
    /// Tuesday 13 October 2026, window Wed 14 – Sun 18 October (docs/redesign/README.md, "Sample data").
    static let sample: RideBoard = {
        let hilly = RouteSummary(name: "Hilly Loop", distanceKm: 51, ascentM: 640,
                                 coordinates: loop(center: Coordinate(latitude: 51.79, longitude: -0.66), distanceKm: 51, seed: 0.4),
                                 cycleTravelURL: URL(string: "https://cycle.travel/map/journey/412907"))
        let potters = RouteSummary(name: "Potters Bar", distanceKm: 77, ascentM: 410,
                                   coordinates: loop(center: Coordinate(latitude: 51.698, longitude: -0.181), distanceKm: 77, seed: 1.7),
                                   cycleTravelURL: URL(string: "https://cycle.travel/map/journey/398114"))
        let braintree = RouteSummary(name: "Braintree", distanceKm: 51, ascentM: 280,
                                     coordinates: loop(center: Coordinate(latitude: 51.878, longitude: 0.553), distanceKm: 51, seed: 2.9),
                                     cycleTravelURL: URL(string: "https://cycle.travel/map/journey/405532"))
        let eastAnglia = RouteSummary(name: "East Anglia", distanceKm: 112, ascentM: 520,
                                      coordinates: loop(center: Coordinate(latitude: 52.2, longitude: 0.9), distanceKm: 112, seed: 4.2))

        let wednesday = Pick(route: hilly, start: date(14, 9), finish: date(14, 12), score: 86,
                             conditions: Conditions(temperatureC: 9...14, windKph: 15, wind: .tailwind, gustKph: 28, sky: .sunnySpells),
                             lastRidden: date(29, 8, month: 9), change: 4, pointsLost: ["temperature": 2.1, "wind": 0, "dryness": 0])
        let thursday = Pick(route: potters, start: date(15, 9), finish: date(15, 13, 20), score: 79,
                            conditions: Conditions(temperatureC: 12...14, windKph: 18, wind: .crosswind, gustKph: 31, sky: .cloudy),
                            lastRidden: date(4, 8, month: 10))
        let braintreeBest = Pick(route: braintree, start: date(14, 9, 30), finish: date(14, 12, 30), score: 61,
                                 conditions: Conditions(temperatureC: 10...14, windKph: 26, wind: .headwind, gustKph: 48, sky: .cloudy),
                                 meetsMinimums: false, pointsLost: ["temperature": 0, "wind": 6.4, "dryness": 0])
        let saturday = Pick(route: hilly, start: date(17, 10), finish: date(17, 13), score: 64,
                            conditions: Conditions(temperatureC: 8...11, windKph: 20, wind: .crosswind, gustKph: 34, sky: .cloudy),
                            lastRidden: date(29, 8, month: 9))
        let sunday = Pick(route: potters, start: date(18, 9, 30), finish: date(18, 13, 50), score: 71,
                          conditions: Conditions(temperatureC: 10...13, windKph: 12, wind: .tailwind, gustKph: 25, sky: .sunnySpells),
                          lastRidden: date(4, 8, month: 10))
        let monday = Pick(route: hilly, start: date(19, 9), finish: date(19, 12), score: 58,
                          conditions: Conditions(temperatureC: 8...12, windKph: 22, wind: .headwind, gustKph: 38, sky: .sunnySpells),
                          lastRidden: date(29, 8, month: 9))
        func daylight(_ day: Int) -> DateInterval { DateInterval(start: date(day, 7, 20), end: date(day, 18, 10)) }
        let forecast = [
            Day(date: date(13, 0), best: nil, sky: .rain, temperatureMaxC: 11, note: "Rain until 15:00. No ride fits after it.", daylight: daylight(13)),
            Day(date: date(14, 0), best: wednesday, sky: .sunnySpells, temperatureMaxC: 14, daylight: daylight(14)),
            Day(date: date(15, 0), best: thursday, sky: .cloudy, temperatureMaxC: 14, daylight: daylight(15)),
            Day(date: date(16, 0), best: nil, sky: .rain, temperatureMaxC: 12, note: "Rain from dawn to dusk", daylight: daylight(16)),
            Day(date: date(17, 0), best: saturday, sky: .cloudy, temperatureMaxC: 13, daylight: daylight(17)),
            Day(date: date(18, 0), best: sunday, sky: .sunnySpells, temperatureMaxC: 13, daylight: daylight(18)),
            Day(date: date(19, 0), best: monday, sky: .sunnySpells, temperatureMaxC: 12, forecastEnds: date(19, 18), daylight: daylight(19)),
        ]

        return RideBoard(
            window: DateInterval(start: date(14, 0), end: date(19, 0)),
            generatedAt: date(13, 8, 12),
            picks: [wednesday, thursday, braintreeBest],
            days: Array(forecast[1...5]),
            forecast: forecast,
            unfit: [Unfit(route: eastAnglia, rideDuration: 7 * 3600 + 5 * 60, windowAllows: 5 * 3600 + 45 * 60)],
            // `RiderSettings.sample`'s comfort settings.
            scoredWith: Comfort(temperatureC: 10...22, headwindKph: 15, crosswindKph: 20)
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

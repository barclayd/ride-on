import Foundation

/// Everything Ride detail shows for one pick (docs/redesign/README.md §2). Presentation values
/// only, like `RideBoard`; `sample(for:on:)` serves previews and the fixture world.
public struct RideDetail: Hashable, Sendable {
    public var pick: RideBoard.Pick
    /// The forecast the score last moved from ("▲ 4 since 07:00").
    public var changeSince: Date?
    /// Short notes under the verdict.
    public var notes: [Note]
    /// Empty when unknown; Ride detail then fetches it from the route's coordinates.
    public var elevation: [ElevationPoint]
    /// The pick's departure first, then up to three alternatives in the window.
    public var departures: [Departure]

    public init(pick: RideBoard.Pick, changeSince: Date?, notes: [Note], elevation: [ElevationPoint], departures: [Departure]) {
        self.pick = pick
        self.changeSince = changeSince
        self.notes = notes
        self.elevation = elevation
        self.departures = departures
    }
}

public extension RideDetail {
    struct Note: Hashable, Sendable {
        public enum Kind: Hashable, Sendable { case temperature, wind, rain, other }
        public var kind: Kind
        public var text: String

        public init(_ kind: Kind, _ text: String) {
            self.kind = kind
            self.text = text
        }
    }

    struct ElevationPoint: Hashable, Sendable {
        public var km: Double
        public var metres: Double

        public init(km: Double, metres: Double) {
            self.km = km
            self.metres = metres
        }
    }

    struct Departure: Hashable, Sendable, Identifiable {
        public var start: Date
        public var finish: Date
        /// 0–100.
        public var score: Int
        /// One per ride hour.
        public var hours: [Hour]
        /// Where the wind blows from, as a phrase: "west-south-west". `nil` when calm or mixed.
        public var windFrom: String?
        /// Felt wind along the route, in order, covering its whole length.
        public var wind: [WindStretch]
        public var factors: [Factor]

        public var id: Date { start }

        public init(start: Date, finish: Date, score: Int, hours: [Hour], windFrom: String?, wind: [WindStretch], factors: [Factor]) {
            self.start = start
            self.finish = finish
            self.score = score
            self.hours = hours
            self.windFrom = windFrom
            self.wind = wind
            self.factors = factors
        }
    }

    struct Hour: Hashable, Sendable, Identifiable {
        public var time: Date
        public var sky: RideBoard.Sky
        public var temperatureC: Double
        public var windKph: Double
        public var gustKph: Double
        /// 0–1.
        public var rainChance: Double

        public var id: Date { time }

        public init(time: Date, sky: RideBoard.Sky, temperatureC: Double, windKph: Double, gustKph: Double, rainChance: Double) {
            self.time = time
            self.sky = sky
            self.temperatureC = temperatureC
            self.windKph = windKph
            self.gustKph = gustKph
            self.rainChance = rainChance
        }
    }

    struct WindStretch: Hashable, Sendable {
        public var wind: RideBoard.Wind
        public var startKm: Double
        public var endKm: Double

        public init(_ wind: RideBoard.Wind, from startKm: Double, to endKm: Double) {
            self.wind = wind
            self.startKm = startKm
            self.endKm = endKm
        }
    }

    /// One of the eight scoring factors, with its plain-English reason.
    struct Factor: Hashable, Sendable {
        public var name: String
        /// 0–100.
        public var score: Int
        public var reason: String

        public init(_ name: String, score: Int, reason: String) {
            self.name = name
            self.score = score
            self.reason = reason
        }
    }
}

// MARK: - Sample

public extension RideDetail {
    /// A plausible detail for any pick on the sample board, built from the pick. Hilly Loop on
    /// Wednesday reproduces the canvas exactly (docs/redesign/README.md §2).
    // ponytail: sample prose is metric and en-GB, like the sample preferences; the API pass
    // replaces all of it with `best.factors`/`best.drawbacks`.
    static func sample(for pick: RideBoard.Pick, on board: RideBoard) -> RideDetail {
        let duration = pick.finish.timeIntervalSince(pick.start)
        // The canvas's alternatives: an hour later, the next morning, three days on.
        let alternatives: [(after: Double, score: Int, warmer: Double, windier: Double, share: Double)] = [
            (0, 0, 0, 0, 0.62), (1, -4, 1, 2, 0.55), (24.5, -12, -1, 4, 0.45), (73, -22, -3, 5, 0.3),
        ]
        let departures = alternatives.compactMap { alt -> Departure? in
            let start = pick.start.addingTimeInterval(alt.after * 3600)
            guard start < board.window.end else { return nil }
            var conditions = pick.conditions
            conditions.temperatureC = (conditions.temperatureC.lowerBound + alt.warmer)...(conditions.temperatureC.upperBound + alt.warmer)
            conditions.windKph += alt.windier
            conditions.gustKph += alt.windier
            return departure(pick.route, start: start, finish: start.addingTimeInterval(duration), score: pick.score + alt.score,
                             conditions: conditions, share: alt.share, lastRidden: pick.lastRidden)
        }

        var notes: [Note] = []
        let start = pick.conditions.temperatureC.lowerBound
        if start < ideal.lowerBound {
            let under = Int(ideal.lowerBound - start)
            notes.append(Note(.temperature, "Down to \(Int(start))° in the first hour, \(under == 1 ? "a degree" : "\(under) degrees") under your ideal range."))
        }
        if pick.conditions.gustKph > gustLimit {
            notes.append(Note(.wind, "Gusts reach \(Int(pick.conditions.gustKph)) \(kph), over your \(Int(gustLimit)) \(kph) limit."))
        }

        return RideDetail(pick: pick,
                          changeSince: pick.change == nil ? nil : board.generatedAt.addingTimeInterval(-72 * 60),
                          notes: notes,
                          elevation: elevation(pick.route),
                          departures: departures)
    }

    private static let ideal = 10.0...22.0
    private static let gustLimit = 45.0
    /// "km/h" that never wraps after the slash (U+2060 word joiner).
    private static let kph = "km/\u{2060}h"

    private static func departure(_ route: RideBoard.RouteSummary, start: Date, finish: Date, score: Int,
                                  conditions: RideBoard.Conditions, share: Double, lastRidden: Date?) -> Departure {
        // One column per hour from the start, the finish's hour included: 09:00 → ~12:00 is four.
        let count = Int(finish.timeIntervalSince(start) / 3600) + 1
        let range = conditions.temperatureC
        let hours = (0..<count).map { i in
            let t = count == 1 ? 0 : Double(i) / Double(count - 1)
            let sunny: [RideBoard.Sky] = [.sunnySpells, .sunny, .sunny, .sunnySpells]
            return Hour(time: start.addingTimeInterval(Double(i) * 3600),
                        sky: conditions.sky == .sunnySpells ? sunny[i % 4] : conditions.sky,
                        // Warms quickly, then levels off before the finish.
                        temperatureC: (range.lowerBound + (range.upperBound - range.lowerBound) * min(1, 1.2 * t)).rounded(),
                        windKph: conditions.windKph + [-1, 0, 2, 1][i % 4],
                        gustKph: conditions.gustKph + [-4, -2, 0, -1][i % 4],
                        rainChance: [0, 0, 0.05, 0.05][i % 4])
        }

        // The pick's felt wind for `share` of the route, then the other two.
        let others = [RideBoard.Wind.tailwind, .crosswind, .headwind].filter { $0 != conditions.wind }
        let distance = route.distanceKm
        let first = (distance * share).rounded()
        let second = (distance * (share + (1 - share) * 0.53)).rounded()
        let wind = [WindStretch(conditions.wind, from: 0, to: first),
                    WindStretch(others[0], from: first, to: second),
                    WindStretch(others[1], from: second, to: distance)]

        let maxRain = Int((hours.map(\.rainChance).max() ?? 0) * 100)
        let gust = Int(conditions.gustKph)
        let duration = Duration.seconds(finish.timeIntervalSince(start))
            .formatted(.units(allowed: [.hours, .minutes], width: .wide).locale(Locale(identifier: "en_GB")))
        let back = clock(finish)
        let novelty = lastRidden.map { ridden in
            let days = london.dateComponents([.day], from: london.startOfDay(for: ridden), to: london.startOfDay(for: start)).day ?? 0
            var style = Date.FormatStyle.dateTime.day().month(.wide).locale(Locale(identifier: "en_GB"))
            style.timeZone = london.timeZone
            return "You rode it \(days) days ago, on \(ridden.formatted(style))."
        } ?? "You haven't ridden it yet."
        let climbing = route.ascentM / distance > 10 ? "makes it a harder one" : "keeps it steady"
        let cloud = [RideBoard.Sky.sunny: 10, .sunnySpells: 40, .cloudy: 80, .rain: 95][conditions.sky] ?? 50

        // The canvas's factor scores, moved with the departure's score.
        let delta = score - 86
        func s(_ base: Int) -> Int { min(100, max(0, base + delta)) }
        let factors = [
            Factor("Rain", score: s(100), reason: "Dry throughout. The highest hourly chance of rain is \(maxRain)%."),
            Factor("Wind", score: s(94), reason: "\(conditions.wind.title) for \(Int(share * 100))% of the distance. Gusts peak at \(gust) \(kph), \(Double(gust) > gustLimit ? "over" : "under") your \(Int(gustLimit)) \(kph) limit."),
            Factor("Time budget", score: s(92), reason: "About \(duration). You're back by \(back), \(back < "17:00" ? "long " : "")before sunset at 18:04."),
            Factor("Surface match", score: s(88), reason: "Sealed roads all the way, right for your road bike."),
            Factor("Temperature", score: s(81), reason: "\(Int(range.lowerBound))–\(Int(range.upperBound))° along the way. Your ideal range is \(Int(ideal.lowerBound))–\(Int(ideal.upperBound))°."),
            Factor("Sky", score: s(76), reason: "\(conditions.sky.title), about \(cloud)% cloud cover."),
            Factor("Intent", score: s(70), reason: "You wanted a steady ride. \(Int(route.ascentM)) m of climbing \(climbing)."),
            Factor("Novelty", score: s(60), reason: novelty),
        ]

        return Departure(start: start, finish: finish, score: score, hours: hours, windFrom: "west-south-west", wind: wind, factors: factors)
    }

    /// Rolling ground with one big climb at about 60% of the way, peaking near 29% of the
    /// route's total ascent (186 m on Hilly Loop).
    private static func elevation(_ route: RideBoard.RouteSummary) -> [ElevationPoint] {
        let steps = Int(route.distanceKm * 2)
        let raw = (0...steps).map { step -> (Double, Double) in
            let t = Double(step) / Double(steps)
            let climb = 130 * exp(-pow((t - 0.6) / 0.12, 2))
            return (t * route.distanceKm, 50 + climb + 25 * sin(2 * .pi * 5 * t + route.distanceKm))
        }
        let scale = (route.ascentM * 0.29) / (raw.map(\.1).max() ?? 1)
        return raw.map { ElevationPoint(km: $0.0, metres: ($0.1 * scale).rounded()) }
    }

    private static let london: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        return calendar
    }()

    /// "12:00" in London time.
    private static func clock(_ date: Date) -> String {
        let parts = london.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

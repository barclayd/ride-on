import Foundation

// "Sky on the Ride" and "Wind on the Ride" on Ride detail (docs/redesign/README.md §2): the
// extension's sky and wind panels (extension/ui/format.ts `skyChip`, extension/ui/wind.ts), as values.

public extension RideDetail {
    /// How much of the ride is in sun, by distance, in ride order.
    struct SkyBreakdown: Hashable, Sendable {
        public enum Kind: CaseIterable, Hashable, Sendable {
            /// `other` in the extension: cloud, overcast, mist, showers and night.
            case sunny, sunnyIntervals, cloud, unknown

            public var title: String {
                switch self {
                case .sunny: "Sunny"
                case .sunnyIntervals: "Sunny intervals"
                case .cloud: "Cloud"
                case .unknown: "Data unavailable"
                }
            }
        }

        public enum Look: Hashable, Sendable { case sun, sunAndCloud, cloud, fog }

        public struct Segment: Hashable, Sendable {
            public var kind: Kind
            /// Share of the distance, 0–1.
            public var share: Double

            public init(_ kind: Kind, share: Double) {
                self.kind = kind
                self.share = share
            }
        }

        /// "Sun and sunny intervals", "Sunny throughout", "Overcast".
        public var summary: String
        public var look: Look
        /// Ride order, neighbours merged. Within an hour the order isn't known.
        public var segments: [Segment]
        /// Each kind's share of the whole ride; kinds that don't appear are left out.
        public var shares: [Kind: Double]
        /// Part of the ride has no sky data.
        public var partial: Bool

        public init(summary: String, look: Look, segments: [Segment], shares: [Kind: Double], partial: Bool) {
            self.summary = summary
            self.look = look
            self.segments = segments
            self.shares = shares
            self.partial = partial
        }

        /// The legend: present kinds in a fixed order.
        public var legend: [(kind: Kind, share: Double)] {
            Kind.allCases.compactMap { kind in shares[kind].flatMap { $0 > 0 ? (kind, $0) : nil } }
        }

        // ponytail: 10% of the forecast distance makes sun a real part of a mix.
        private static let realPart = 0.1

        /// The extension's sky chip rules over per-hour shares (`km`, each hour's kinds) and the whole
        /// ride's. `fractions` is the whole ride's raw categories, for naming a cloudy sky.
        /// `nil` when nothing is known.
        public static func make(ride: [Kind: Double], hours: [(km: Double, kinds: [Kind: Double])],
                                categories: [String: Double], partial: Bool) -> SkyBreakdown? {
            func share(_ k: [Kind: Double], _ kind: Kind) -> Double { k[kind] ?? 0 }
            let sunny = share(ride, .sunny), intervals = share(ride, .sunnyIntervals), other = share(ride, .cloud)
            let known = sunny + intervals + other
            guard known > 0 else { return nil }
            let incomplete = partial || share(ride, .unknown) > 0

            var summary: String, look: Look
            if sunny + intervals < other {
                let cloudy = categories["cloudy"] ?? 0, overcast = categories["overcast"] ?? 0, fog = categories["obscured"] ?? 0
                // Showers or night without cloud or fog: the forecast above already says so.
                guard cloudy + overcast > 0 || fog > 0 else { return nil }
                look = fog > cloudy + overcast ? .fog : .cloud
                summary = fog > cloudy + overcast ? "Fog" : overcast >= cloudy ? "Overcast" : "Cloudy"
            } else {
                // A rounded share of 1 isn't enough: every ride hour must be sun alone.
                let pure = ([ride] + hours.map(\.kinds)).allSatisfy { share($0, .sunnyIntervals) == 0 && share($0, .cloud) == 0 }
                look = pure ? .sun : .sunAndCloud
                if pure { summary = incomplete ? "Sunny where forecast" : "Sunny throughout" }
                else if sunny / known < realPart { summary = "Sunny intervals" }
                else { summary = intervals >= other ? "Sun and sunny intervals" : "Sun and cloud" }
            }

            // The order within an hour isn't known: carry on the last kind, then the rest, the gap last.
            let km = hours.reduce(0) { $0 + $1.km }
            var segments: [Segment] = []
            for hour in hours.isEmpty ? [(km: 1, kinds: ride)] : hours {
                var order = [segments.last?.kind ?? .sunny]
                order += Kind.allCases.filter { $0 != order[0] }
                for kind in order {
                    let part = share(hour.kinds, kind) * hour.km / (km > 0 ? km : 1)
                    guard part > 0 else { continue }
                    if segments.last?.kind == kind { segments[segments.count - 1].share += part }
                    else { segments.append(Segment(kind, share: part)) }
                }
            }
            return SkyBreakdown(summary: summary, look: look, segments: segments,
                                shares: ride.filter { $0.value > 0 }, partial: incomplete)
        }
    }

    /// The wind along the ride: where each effect falls, where it blows from and the gusts.
    struct WindBreakdown: Hashable, Sendable {
        public enum Effect: CaseIterable, Hashable, Sendable {
            case tailwind, crosswind, headwind, light

            public var title: String {
                switch self {
                case .tailwind: "Tailwind"
                case .crosswind: "Crosswind"
                case .headwind: "Headwind"
                case .light: "Light wind"
                }
            }
        }

        /// A part of the ride with one effect: the API's wind stretch, or a ride hour without one.
        public struct Stretch: Hashable, Sendable {
            public var effect: Effect
            /// Shares of the distance at its start and end, 0–1.
            public var from: Double
            public var to: Double
            /// Where the wind blows from; `nil` when calm or variable.
            public var fromDegrees: Double?
            public var kph: Double
            /// The largest gust against the rider; `nil` when unknown.
            public var adverseGustKph: Double?
            public var start: Date
            public var end: Date
            /// How much of it each effect covers: a ride hour can mix them, a wind stretch can't.
            public var parts: [Effect: Double]

            public init(_ effect: Effect, from: Double, to: Double, fromDegrees: Double?, kph: Double,
                        adverseGustKph: Double?, start: Date, end: Date, parts: [Effect: Double]? = nil) {
                self.effect = effect
                self.parts = parts ?? [effect: 1]
                self.from = from
                self.to = to
                self.fromDegrees = fromDegrees
                self.kph = kph
                self.adverseGustKph = adverseGustKph
                self.start = start
                self.end = end
            }

            public var share: Double { to - from }
        }

        public struct Gusts: Hashable, Sendable {
            /// Over the rider's comfort or limit.
            public var warn: Bool
            /// "Gusts up to 27 mph"
            public var title: String
            /// "From the side, 09:31–13:21. Over your 16 mph comfort."
            public var text: String

            public init(warn: Bool, title: String, text: String) {
                self.warn = warn
                self.title = title
                self.text = text
            }
        }

        public struct Block: Hashable, Sendable {
            public var effect: Effect
            public var share: Double
            /// "SW" where the block is wide enough for it.
            public var label: String?
        }

        public struct Share: Hashable, Sendable {
            public var effect: Effect
            public var share: Double
            /// Distance-weighted average where it blows.
            public var kph: Double
        }

        /// Ride order, covering the whole ride.
        public var stretches: [Stretch]
        public var averageKph: Double
        public var gusts: Gusts?
        /// Back where it started, so no finish marker; `nil` when unknown.
        public var roundTrip: Bool?
        /// The API's wind stretches rather than ride hours, so placed exactly enough to colour the route.
        public var exact: Bool

        public init(stretches: [Stretch], averageKph: Double, gusts: Gusts?, roundTrip: Bool?, exact: Bool) {
            self.stretches = stretches
            self.averageKph = averageKph
            self.gusts = gusts
            self.roundTrip = roundTrip
            self.exact = exact
        }

        /// Below this the wind's direction isn't worth naming, whatever the unit.
        public static let namedKph = 10.0
        /// Stretches under 5% of the ride are too short to name.
        static let short = 0.05
        // ponytail: a compass letter needs about a tenth of the bar to fit.
        static let labelled = 0.1

        static let points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        static let headings = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
        static func sector(_ degrees: Double) -> Int { Int(((degrees.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 45).rounded()) % 8 }

        /// The bar: neighbours with the same effect and compass point merged; calm merges whatever its direction.
        public var blocks: [Block] {
            var blocks: [Block] = []
            for s in stretches {
                let point = s.effect == .light ? nil : s.fromDegrees.map { Self.points[Self.sector($0)] }
                if let last = blocks.last, last.effect == s.effect, last.label == point { blocks[blocks.count - 1].share += s.share }
                else { blocks.append(Block(effect: s.effect, share: s.share, label: point)) }
            }
            return blocks.map { Block(effect: $0.effect, share: $0.share, label: $0.share >= Self.labelled ? $0.label : nil) }
        }

        /// Each effect's share of the distance and its average speed, largest first.
        public var legend: [Share] { Self.legend(stretches) }

        static func legend(_ stretches: [Stretch]) -> [Share] {
            Effect.allCases.compactMap { effect -> Share? in
                let share = stretches.reduce(0) { $0 + ($1.parts[effect] ?? 0) * $1.share }
                guard share > 0 else { return nil }
                let kph = stretches.reduce(0) { $0 + ($1.parts[effect] ?? 0) * $1.share * $1.kph }
                return Share(effect: effect, share: share, kph: kph / share)
            }
            .sorted { $0.share > $1.share }
        }

        /// The map's runs: neighbours with the same effect merged. Short ones stay, never recoloured.
        public var runs: [Run] { Self.merged(stretches.map { Run(effect: $0.effect, from: $0.from, to: $0.to) }) }

        public struct Run: Hashable, Sendable {
            public var effect: Effect
            public var from: Double
            public var to: Double
        }

        private static func merged(_ runs: [Run]) -> [Run] {
            var merged: [Run] = []
            for run in runs {
                if merged.last?.effect == run.effect { merged[merged.count - 1].to = run.to } else { merged.append(run) }
            }
            return merged
        }

        /// Where the wind comes from over the named stretches, in ride order: ["south-west", "west"].
        /// Empty when it's light all the way.
        public var from: [String] {
            var seen: [String] = []
            for s in named {
                let heading = Self.headings[Self.sector(s.fromDegrees ?? 0)]
                if !seen.contains(heading) { seen.append(heading) }
            }
            return Array(seen.prefix(2))
        }

        /// The bearing the wind blows towards, for a compass needle: the mean over the named stretches.
        public var towardsDegrees: Double? {
            let x = named.reduce(0) { $0 + $1.share * sin(($1.fromDegrees ?? 0) * .pi / 180) }
            let y = named.reduce(0) { $0 + $1.share * cos(($1.fromDegrees ?? 0) * .pi / 180) }
            guard hypot(x, y) > 1e-6 else { return nil }
            return (atan2(x, y) * 180 / .pi + 180 + 360).truncatingRemainder(dividingBy: 360)
        }

        private var named: [Stretch] {
            stretches.filter { $0.effect != .light && $0.fromDegrees != nil && $0.share >= Self.short }
        }

        /// The extension's gusts row. Raw km/h comparisons, like the extension; `speed` and `clock`
        /// write the rider's units and times.
        public static func gusts(peakKph: Double, adverseKph: Double?, comfortKph: Double?, limitKph: Double?,
                                 stretches: [Stretch], roundTrip: Bool?,
                                 speed: (Double) -> String, clock: (Date) -> String) -> Gusts {
            let comfort = comfortKph ?? 35
            let overLimit = limitKph.map { peakKph > $0 } ?? false
            let overComfort = (adverseKph ?? peakKph) > comfort
            let title = "Gusts up to \(speed(peakKph))"
            if !overLimit && !overComfort {
                let tail = legend(stretches).first { $0.effect == .tailwind }?.share ?? 0
                let against = adverseKph.map { $0 < 1 ? "None against you." : "At most \(speed($0)) against you." }
                    ?? "Within your \(speed(comfort)) comfort."
                return Gusts(warn: false, title: title, text: (tail > 0.5 ? "Mostly behind you, so they help. " : "") + against)
            }
            // Name the stretch when the gusts past comfort fall in one place: calmer gaps under 5% don't split it.
            let over = stretches.filter { ($0.adverseGustKph ?? 0) > comfort }
            let together = zip(over, over.dropFirst()).allSatisfy { $1.from - $0.to < short }
            var whereText = ""
            if overComfort, let first = over.first, let last = over.last, together {
                let worst = over.max { ($0.adverseGustKph ?? 0) < ($1.adverseGustKph ?? 0) } ?? first
                let phrase = switch worst.effect {
                case .headwind: "Into your face"
                case .crosswind: "From the side"
                case .tailwind: "From behind"
                case .light: "In light wind"
                }
                let part = first.from >= 0.5 ? (roundTrip == true ? " on the way back" : " late in the ride")
                    : last.to <= 0.5 ? (roundTrip == true ? " on the way out" : " early in the ride") : ""
                whereText = "\(phrase)\(part), \(clock(first.start))–\(clock(last.end)). "
            } else if let adverseKph, adverseKph >= 1 {
                whereText = "Up to \(speed(adverseKph)) against you. "
            }
            let limit = limitKph.flatMap { overLimit ? "Over your \(speed($0)) limit." : nil } ?? "Over your \(speed(comfort)) comfort."
            return Gusts(warn: true, title: title, text: whereText + limit)
        }

        /// Back within 1 km, or 5% of the distance, of the start: a loop or an out-and-back.
        public static func isRoundTrip(_ coordinates: [Coordinate]) -> Bool? {
            guard let first = coordinates.first, let last = coordinates.last, coordinates.count > 1 else { return nil }
            let trace = RouteTrace(coordinates)
            return metres(first, last) <= max(1000, 0.05 * trace.totalMetres)
        }

        /// For VoiceOver: "Heads north-east with the wind behind, then south across the wind. Wind from the south-west."
        public func journey(along coordinates: [Coordinate]) -> String {
            let wind = from.isEmpty ? "Light wind." : "Wind from the \(from.joined(separator: ", then "))."
            let trace = RouteTrace(coordinates)
            guard trace.totalMetres > 0 else { return wind }
            let with: [Effect: String] = [.tailwind: "with the wind behind", .crosswind: "across the wind",
                                          .headwind: "into the wind", .light: "in light wind"]
            var legs: [String] = []
            for run in summaryRuns {
                let heading = Self.headings[Self.sector(Self.bearing(trace.at(run.from), trace.at(run.to)))]
                let leg = "\(heading) \(with[run.effect] ?? "")"
                if legs.last != leg { legs.append(leg) }
            }
            return "Heads \(legs.prefix(4).joined(separator: ", then ")). \(wind)"
        }

        /// For the spoken route only: short runs join the longer neighbour.
        private var summaryRuns: [Run] {
            var runs = self.runs
            func length(_ i: Int) -> Double { runs[i].to - runs[i].from }
            while runs.count > 1, let i = runs.indices.filter({ length($0) < Self.short }).min(by: { length($0) < length($1) }) {
                let into = i == 0 ? 1 : i == runs.count - 1 ? i - 1 : length(i - 1) >= length(i + 1) ? i - 1 : i + 1
                runs[into].from = min(runs[into].from, runs[i].from)
                runs[into].to = max(runs[into].to, runs[i].to)
                runs.remove(at: i)
                runs = Self.merged(runs)
            }
            return runs
        }

        static func bearing(_ a: Coordinate, _ b: Coordinate) -> Double {
            let rad = Double.pi / 180
            let y = sin((b.longitude - a.longitude) * rad) * cos(b.latitude * rad)
            let x = cos(a.latitude * rad) * sin(b.latitude * rad) - sin(a.latitude * rad) * cos(b.latitude * rad) * cos((b.longitude - a.longitude) * rad)
            return atan2(y, x) / rad
        }
    }
}

/// Great-circle metres between two points.
func metres(_ a: Coordinate, _ b: Coordinate) -> Double {
    let rad = Double.pi / 180
    let dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad
    let h = pow(sin(dLat / 2), 2) + cos(a.latitude * rad) * cos(b.latitude * rad) * pow(sin(dLon / 2), 2)
    return 2 * 6_371_000 * asin(min(1, sqrt(h)))
}

/// A route's points with their share of the distance, for placing stretches along it.
public struct RouteTrace: Sendable {
    public var coordinates: [Coordinate]
    /// Share of the distance at each point, 0–1, non-decreasing.
    public var fractions: [Double]
    public var totalMetres: Double

    public init(_ coordinates: [Coordinate]) {
        var along = [0.0]
        for (a, b) in zip(coordinates, coordinates.dropFirst()) { along.append(along[along.count - 1] + metres(a, b)) }
        let total = along.last ?? 0
        self.coordinates = coordinates
        self.totalMetres = total
        self.fractions = along.map { total > 0 ? $0 / total : 0 }
    }

    /// The point `fraction` of the way along.
    public func at(_ fraction: Double) -> Coordinate {
        guard let first = coordinates.first, let last = coordinates.last else { return Coordinate(latitude: 0, longitude: 0) }
        guard let i = fractions.firstIndex(where: { $0 >= fraction }) else { return last }
        guard i > 0 else { return first }
        let span = fractions[i] - fractions[i - 1]
        let t = span > 0 ? (fraction - fractions[i - 1]) / span : 0
        let a = coordinates[i - 1], b = coordinates[i]
        return Coordinate(latitude: a.latitude + t * (b.latitude - a.latitude), longitude: a.longitude + t * (b.longitude - a.longitude))
    }

    /// `count` points evenly spaced along the distance, ends included.
    public func resampled(_ count: Int) -> [Coordinate] {
        guard coordinates.count > 1, totalMetres > 0, count > 1 else { return coordinates }
        var points: [Coordinate] = []
        var i = 1
        for step in 0..<count {
            let fraction = Double(step) / Double(count - 1)
            while i < fractions.count - 1 && fractions[i] < fraction { i += 1 }
            let span = fractions[i] - fractions[i - 1]
            let t = span > 0 ? min(1, max(0, (fraction - fractions[i - 1]) / span)) : 0
            let a = coordinates[i - 1], b = coordinates[i]
            points.append(Coordinate(latitude: a.latitude + t * (b.latitude - a.latitude), longitude: a.longitude + t * (b.longitude - a.longitude)))
        }
        return points
    }

    /// The points from `from` to `to` of the way along, ends interpolated.
    public func slice(_ from: Double, _ to: Double) -> [Coordinate] {
        var points = [at(from)]
        for (point, fraction) in zip(coordinates, fractions) where fraction > from && fraction < to { points.append(point) }
        points.append(at(to))
        return points
    }
}

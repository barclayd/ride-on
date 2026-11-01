import Foundation

/// Everything the Routes tab shows: the saved routes, which of them are on the shortlist, and
/// the rides marked as ridden. Presentation values only, like `RideBoard`: `RouteLibraryLoader` builds
/// it from `GET /routes`, `GET /route-selection` and `GET /rides`; previews and the fixture
/// world use `.sample`.
public struct RouteLibrary: Hashable, Sendable {
    public var routes: [Route]
    /// The shortlisted routes' ids, in shortlist order. Rides ranks only these.
    public var shortlist: [UUID]
    /// The most routes the shortlist holds.
    public var shortlistLimit: Int
    /// Rides marked as ridden, newest first.
    public var rides: [Ride]

    public init(routes: [Route], shortlist: [UUID], shortlistLimit: Int = 12, rides: [Ride]) {
        self.routes = routes
        self.shortlist = shortlist
        self.shortlistLimit = shortlistLimit
        self.rides = rides
    }
}

public extension RouteLibrary {
    struct Route: Hashable, Sendable, Identifiable {
        public var id: UUID
        public var name: String
        public var distanceKm: Double
        public var ascentM: Double
        /// The unpaved share, 0–1; `nil` when the surface is unknown.
        public var unpaved: Double?
        public var source: Source
        public var lastRidden: Date?
        public var coordinates: [Coordinate]

        public init(id: UUID = UUID(), name: String, distanceKm: Double, ascentM: Double, unpaved: Double?, source: Source,
                    lastRidden: Date? = nil, coordinates: [Coordinate]) {
            self.id = id
            self.name = name
            self.distanceKm = distanceKm
            self.ascentM = ascentM
            self.unpaved = unpaved
            self.source = source
            self.lastRidden = lastRidden
            self.coordinates = coordinates
        }
    }

    enum Source: String, Hashable, Sendable {
        case cycleTravel, strava, garmin, gpxFile

        public var title: String {
            switch self {
            case .cycleTravel: "cycle.travel"
            case .strava: "Strava"
            case .garmin: "Garmin"
            case .gpxFile: "GPX file"
            }
        }
    }

    /// A route marked as ridden (docs/ride-history.md). `riddenOn` is a calendar day, never a
    /// time, and `route` is the route as it was then, so later edits don't rewrite history.
    struct Ride: Hashable, Sendable, Identifiable {
        public var id: String
        public var route: Route
        public var riddenOn: Date
        /// The forecast saved when the ride was planned. Never what the weather was on the day.
        public var plan: Plan?

        public init(id: String, route: Route, riddenOn: Date, plan: Plan?) {
            self.id = id
            self.route = route
            self.riddenOn = riddenOn
            self.plan = plan
        }
    }

    struct Plan: Hashable, Sendable {
        public var start: Date
        public var temperatureC: Double
        public var windKph: Double
        public var sky: RideBoard.Sky

        public init(start: Date, temperatureC: Double, windKph: Double, sky: RideBoard.Sky) {
            self.start = start
            self.temperatureC = temperatureC
            self.windKph = windKph
            self.sky = sky
        }
    }
}

// MARK: - Sample

public extension RouteLibrary {
    /// Tuesday 13 October 2026, matching `RideBoard.sample`: the four shortlisted routes are
    /// the board's routes, same ids and loops (docs/redesign/README.md, "Routes").
    static let sample: RouteLibrary = {
        typealias S = SampleRoutes
        func route(_ shape: SampleRoutes.Shape, unpaved: Double?, source: Source, ridden: Date?) -> Route {
            Route(id: shape.id, name: shape.name, distanceKm: shape.distanceKm, ascentM: shape.ascentM, unpaved: unpaved,
                  source: source, lastRidden: ridden, coordinates: shape.coordinates)
        }
        let hilly = route(S.hilly, unpaved: 0, source: .cycleTravel, ridden: S.date(29, 0, month: 9))
        let potters = route(S.potters, unpaved: 0, source: .cycleTravel, ridden: S.date(2, 0, month: 9))
        let braintree = route(S.braintree, unpaved: 0, source: .garmin, ridden: nil)
        let east = route(S.eastAnglia, unpaved: 0, source: .cycleTravel, ridden: S.date(14, 0, month: 7))
        let lea = route(S.lea, unpaved: 0.46, source: .strava, ridden: S.date(3, 0))
        let chilterns = route(S.chilterns, unpaved: 0, source: .garmin, ridden: nil)
        let epping = route(S.epping, unpaved: 0.62, source: .gpxFile, ridden: S.date(21, 0, month: 9))
        let boxHill = route(S.boxHill, unpaved: 0, source: .cycleTravel, ridden: S.date(12, 0, month: 8))
        let ware = route(S.ware, unpaved: nil, source: .gpxFile, ridden: nil)

        func ride(_ n: Int, _ route: Route, _ day: Int, month: Int, plan: (hour: Int, minute: Int, temperature: Double, wind: Double, sky: RideBoard.Sky)?) -> Ride {
            Ride(id: "ride-\(n)", route: route, riddenOn: S.date(day, 0, month: month),
                 plan: plan.map { Plan(start: S.date(day, $0.hour, $0.minute, month: month), temperatureC: $0.temperature, windKph: $0.wind, sky: $0.sky) })
        }

        return RouteLibrary(
            routes: [hilly, potters, braintree, east, lea, chilterns, epping, boxHill, ware],
            shortlist: [hilly.id, potters.id, braintree.id, east.id],
            rides: [
                ride(1, lea, 3, month: 10, plan: (10, 0, 13, 14, .sunnySpells)),
                ride(2, hilly, 29, month: 9, plan: (9, 0, 15, 9, .sunny)),
                ride(3, epping, 21, month: 9, plan: nil),
                ride(4, hilly, 13, month: 9, plan: (8, 30, 17, 12, .sunny)),
                ride(5, potters, 2, month: 9, plan: (9, 30, 19, 16, .cloudy)),
                ride(6, boxHill, 12, month: 8, plan: (7, 0, 22, 8, .sunny)),
                ride(7, hilly, 3, month: 8, plan: nil),
                ride(8, east, 14, month: 7, plan: (7, 30, 21, 11, .sunnySpells)),
            ])
    }()
}

/// The sample routes' shapes, shared by `RideBoard.sample` and `RouteLibrary.sample` so a route
/// is the same loop with the same id on Rides and Routes. Every loop starts and ends at `home`.
enum SampleRoutes {
    struct Shape {
        var id: UUID
        var name: String
        var distanceKm: Double
        var ascentM: Double
        var coordinates: [Coordinate]

        init(_ n: Int, _ name: String, km: Double, climb: Double, bearing: Double, seed: Double) {
            id = UUID(uuidString: String(format: "5A3B1E00-0000-4000-8000-%012d", n))!
            self.name = name
            distanceKm = km
            ascentM = climb
            coordinates = SampleRoutes.loop(bearing: bearing, distanceKm: km, seed: seed)
        }
    }

    /// St Albans, where every sample loop starts.
    static let home = Coordinate(latitude: 51.7527, longitude: -0.3360)

    static let hilly = Shape(1, "Hilly Loop", km: 51, climb: 640, bearing: 300, seed: 0.4)
    static let potters = Shape(2, "Potters Bar", km: 77, climb: 410, bearing: 140, seed: 1.7)
    static let braintree = Shape(3, "Braintree", km: 51, climb: 280, bearing: 60, seed: 2.9)
    static let eastAnglia = Shape(4, "East Anglia", km: 112, climb: 520, bearing: 20, seed: 4.2)
    static let lea = Shape(5, "Lea Valley Gravel", km: 42, climb: 180, bearing: 95, seed: 0.9)
    static let chilterns = Shape(6, "Chilterns Classic", km: 96, climb: 1240, bearing: 255, seed: 3.3)
    static let epping = Shape(7, "Epping Forest Trails", km: 34, climb: 290, bearing: 115, seed: 5.1)
    static let boxHill = Shape(8, "Box Hill Reps", km: 68, climb: 1050, bearing: 185, seed: 2.2)
    static let ware = Shape(9, "Ware and Hertford", km: 58, climb: 470, bearing: 45, seed: 1.2)

    static func date(_ day: Int, _ hour: Int, _ minute: Int = 0, month: Int = 10) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/London")!
        return calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    /// A wobbly closed loop about `distanceKm` round that leaves `home` heading out along
    /// `bearing` (degrees from north) and comes back to it.
    static func loop(bearing: Double, distanceKm: Double, seed: Double) -> [Coordinate] {
        let radiusKm = distanceKm / (2 * .pi) * 0.85
        let b = bearing * .pi / 180
        let (centreEast, centreNorth) = (radiusKm * sin(b), radiusKm * cos(b))
        let start = atan2(-centreNorth, -centreEast)
        return (0...120).map { step in
            let t = Double(step) / 120 * 2 * .pi
            // Both wobbles are zero at t = 0 and 2π, so the loop passes through home.
            let r = radiusKm * (1 + 0.22 * (sin(3 * t + seed) - sin(seed)) + 0.1 * (cos(5 * t + 2 * seed) - cos(2 * seed)))
            let east = centreEast + r * cos(start + t)
            let north = centreNorth + r * sin(start + t)
            return Coordinate(latitude: home.latitude + north / 111,
                              longitude: home.longitude + east / (111 * cos(home.latitude * .pi / 180)))
        }
    }
}

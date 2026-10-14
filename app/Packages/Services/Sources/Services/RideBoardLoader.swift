import Foundation
import Models
import Engine

/// Builds the Rides screen from the API (docs/api.md, docs/planning-api.md): the shortlist saved
/// in the extension, ranked across the saved planning days, with each route's source and geometry.
public enum RideBoardLoader {
    /// `nil` when nothing is shortlisted. A `window` from the Ride Window sheet is saved as the
    /// planning choice (docs/planning-api.md, "Saved planning"); without one, the saved choice is used.
    public static func load(window: RideWindow? = nil) async throws -> RideBoard? {
        let selection: SelectionResponse = try await RideOnAPI.send("/route-selection")
        let ids = selection.selection.routeIds
        guard !ids.isEmpty else { return nil }
        let user: UserResponse? = try? await RideOnAPI.send("/users/me")
        if let window, let version = user?.user.version {
            // ponytail: a conflicting edit (409) keeps the old saved window; this load still uses the new one.
            let patch = PlanningPatch(expectedVersion: version, settings: .init(planning: .init(
                days: window.quickPick.map { PlanningDays(kind: "preset", preset: $0.rawValue) } ?? .dates(window.days),
                window: PlanningWindow(window.hours))))
            let _: UserResponse? = try? await RideOnAPI.send("/users/me", method: "PATCH", body: patch)
        }
        let saved = user?.user.settings?.planning
        let days = window.map { PlanningDays.dates($0.days) } ?? saved?.days?.resolved ?? .dates(RideWindow.QuickPick.next.days(from: .now))
        let hours = window?.hours ?? saved?.window?.hours ?? .daylight
        let request = RecommendationRequest(routeIds: ids, days: days, previewDays: 7, riding: .init(window: PlanningWindow(hours)))
        async let recommendation: Recommendation = RideOnAPI.send("/recommendations", body: request)
        async let summaries: SummariesResponse = RideOnAPI.send("/rides/summaries", body: SummariesRequest(routeIds: ids))
        async let routes = routeInfo(ids)
        var board = try await board(from: recommendation, routes: routes, summaries: summaries.summaries)
        board.hours = hours
        return board
    }

    /// About 100 heights spaced evenly along the route, its x axis scaled to the route's distance.
    public static func elevation(of route: RideBoard.RouteSummary, using client: any ElevationClient) async throws -> [RideDetail.ElevationPoint] {
        let points = route.coordinates
        var along = [0.0]
        for (a, b) in zip(points, points.dropFirst()) { along.append(along[along.count - 1] + GPXGeometry.haversineKm(a, b)) }
        let total = along[along.count - 1]
        guard total > 0 else { return [] }
        var index = 0
        let samples = (0...100).map { step -> (km: Double, coordinate: Coordinate) in
            let km = total * Double(step) / 100
            while index < along.count - 1, along[index] < km { index += 1 }
            return (km, points[index])
        }
        let heights = try await client.elevations(coordinates: samples.map(\.coordinate))
        let scale = route.distanceKm / total
        return zip(samples, heights).compactMap { sample, height in
            height.map { RideDetail.ElevationPoint(km: sample.km * scale, metres: $0) }
        }
    }

    // ponytail: geometry is refetched on every load; cache it by route `version` if that gets slow.
    private static func routeInfo(_ ids: [String]) async throws -> [String: RouteInfo] {
        try await withThrowingTaskGroup(of: (String, RouteInfo).self) { group in
            for id in ids {
                group.addTask {
                    async let route: RouteResponse = RideOnAPI.send("/routes/\(id)")
                    async let geometry: GeometryResponse = RideOnAPI.send("/routes/\(id)/geometry")
                    let source = try await route.route.source
                    let url = source.flatMap { $0.providerId == "cycle-travel" ? URL(string: "https://cycle.travel/map/journey/\($0.externalId)") : nil }
                    let coordinates = try await geometry.geometry.map { PolylineDecoder.decode($0.data, precision: 6) } ?? []
                    return (id, RouteInfo(coordinates: coordinates, cycleTravelURL: url))
                }
            }
            return try await group.reduce(into: [:]) { $0[$1.0] = $1.1 }
        }
    }

    // MARK: Mapping

    static func board(from response: Recommendation, routes: [String: RouteInfo], summaries: [Summary]) -> RideBoard {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: response.timeZone) ?? .current
        func day(_ string: String) -> Date? {
            let parts = string.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
        }
        let lastRidden = Dictionary(summaries.compactMap { s in s.lastRiddenOn.flatMap(day).map { (s.routeId, $0) } }, uniquingKeysWith: max)
        let results = Dictionary((response.rankings + response.unranked).map { ($0.routeId, $0) }, uniquingKeysWith: { first, _ in first })

        func route(_ id: String) -> RideBoard.RouteSummary? {
            guard let uuid = UUID(uuidString: id), let result = results[id] else { return nil }
            return RideBoard.RouteSummary(id: uuid, name: result.routeName, distanceKm: result.distanceKm, ascentM: result.ascentM ?? 0,
                                          coordinates: routes[id]?.coordinates ?? [], cycleTravelURL: routes[id]?.cycleTravelURL)
        }
        var details: [String: RideDetail] = [:]
        func pick(_ id: String, _ best: Departure) -> RideBoard.Pick? {
            guard let route = route(id), let result = results[id] else { return nil }
            let pick = RideBoard.Pick(route: route, start: best.departureAt, finish: best.finishAt, score: Int(best.score.rounded()),
                                      conditions: conditions(best.conditions), meetsMinimums: best.standards.status != "below",
                                      lastRidden: lastRidden[id])
            let others = ([result.best].compactMap { $0 } + result.alternatives).filter { $0.departureAt != best.departureAt }
            let preferences = response.resolvedPreferences
            details[pick.id] = RideDetail(pick: pick, changeSince: nil,
                                          notes: preferences.map { notes(best, fit: result.distanceFit, preferences: $0) } ?? notes(best.drawbacks),
                                          elevation: [],
                                          departures: ([best] + others).prefix(4).map { departure($0, route: route, preferences: preferences) })
            return pick
        }

        let picks = response.rankings.compactMap { result in result.best.flatMap { pick(result.routeId, $0) } }
        var days: [RideBoard.Day] = [], forecast: [RideBoard.Day] = []
        for summary in response.days {
            guard let date = day(summary.date) else { continue }
            let best = summary.best.flatMap { best in summary.recommendedRouteId.flatMap { pick($0, best) } }
            // ponytail: the API has no day-level sky when nothing's rideable.
            let entry = RideBoard.Day(date: date, best: best, sky: best?.conditions.sky ?? .cloudy, temperatureMaxC: summary.temperatureMaxC,
                                      note: note(summary), forecastEnds: summary.until,
                                      daylight: summary.daylight.flatMap { $0.sunset >= $0.sunrise ? DateInterval(start: $0.sunrise, end: $0.sunset) : nil })
            forecast.append(entry)
            if summary.selected { days.append(entry) }
        }
        let unfit = response.unranked.filter { $0.status == "no_feasible_departure" }.compactMap { result -> RideBoard.Unfit? in
            let window = result.effectiveWindow ?? result.daylight
            return route(result.routeId).map {
                RideBoard.Unfit(route: $0, rideDuration: result.estimatedDurationMinutes * 60,
                                windowAllows: window.map { $0.end.timeIntervalSince($0.start) } ?? 0)
            }
        }
        let dates = (response.range?.dates ?? []).compactMap(day)
        let start = dates.first ?? calendar.startOfDay(for: response.generatedAt)
        let end = calendar.date(byAdding: .day, value: 1, to: dates.last ?? start) ?? start
        return RideBoard(window: DateInterval(start: start, end: end), generatedAt: response.generatedAt,
                         picks: picks, days: days, forecast: forecast, unfit: unfit, details: details,
                         credits: response.weather?.attribution?.map { RideBoard.Credit(text: $0.text, url: $0.url) } ?? [])
    }

    /// Why a day has no ride, or what it's missing (docs/planning-api.md, "Day tiles"). A forecast
    /// cutoff shows as `Day.forecastEnds` instead.
    static func note(_ day: Recommendation.Day) -> String? {
        switch day.availabilityReason {
        case "partial_coverage" where day.until == nil: "Some forecast hours are missing"
        case "outside_forecast_horizon": "Not forecast yet"
        case "provider_unavailable": "Forecast unavailable"
        case "missing_data": "Forecast details are missing"
        case "no_feasible_departure": "No tracked route fits your hours"
        case "no_remaining_window": "Too late to ride"
        default: nil
        }
    }

    static func conditions(_ c: Conditions) -> RideBoard.Conditions {
        RideBoard.Conditions(temperatureC: c.temperatureC.minimum...c.temperatureC.maximum, windKph: c.averageWindSpeedKph,
                             wind: wind(c), gustKph: c.maximumGustKph, sky: sky(c))
    }

    /// The wind felt over most of the distance; the strongest average component without shares.
    static func wind(_ c: Conditions) -> RideBoard.Wind {
        let shares: [(RideBoard.Wind, Double)] = c.windDistanceFractions.map { [(.tailwind, $0.tailwind), (.crosswind, $0.crosswind), (.headwind, $0.headwind)] }
            ?? [(.tailwind, c.averageTailwindKph), (.crosswind, c.averageCrosswindKph), (.headwind, c.averageHeadwindKph)]
        return shares.max { $0.1 < $1.1 }?.0 ?? .crosswind
    }

    static func sky(_ c: Conditions) -> RideBoard.Sky {
        if let rain = c.precipitationSummary, rain != "dry", rain != "possible" { return .rain }
        if let top = c.skyConditionDistanceFractions?.max(by: { $0.value < $1.value }), top.value > 0 {
            switch top.key {
            case "sunny", "clearNight": return .sunny
            case "sunnyIntervals", "partlyCloudyNight": return .sunnySpells
            case "precipitation": return .rain
            default: return .cloudy
            }
        }
        if let cloud = c.cloudCoverFraction?.mean { return cloud < 0.3 ? .sunny : cloud < 0.7 ? .sunnySpells : .cloudy }
        return .cloudy
    }

    /// The notes under the verdict, with the rider's own numbers: "Gusts reach 40 km/h, over your 35 km/h limit."
    /// The same rules as the API's `drawbacks` (worker engine.ts), less the cloud and data-quality caveats.
    static func notes(_ d: Departure, fit: RouteResult.DistanceFit?, preferences p: Preferences) -> [RideDetail.Note] {
        let c = d.conditions
        /// Rounded value and limit, when the rounded value is still over the limit.
        func over(_ value: Double?, _ limit: Double) -> (value: Int, limit: Int)? {
            guard let value, Int(value.rounded()) > Int(limit.rounded()) else { return nil }
            return (Int(value.rounded()), Int(limit.rounded()))
        }
        func degrees(_ n: Int) -> String { n == 1 ? "a degree" : "\(n) degrees" }
        var notes: [RideDetail.Note] = []
        let low = Int(c.temperatureC.minimum.rounded()), ideal = Int(p.temperature.comfortMinC.rounded())
        if low < ideal {
            let starts = d.rideHours.first?.conditions?.temperatureC.minimum == c.temperatureC.minimum
            notes.append(.init(.temperature, "\(starts ? "Starts at" : "Down to") \(low)°, \(degrees(ideal - low)) under your ideal range."))
        }
        if let (high, ideal) = over(c.temperatureC.maximum, p.temperature.comfortMaxC) {
            notes.append(.init(.temperature, "Up to \(high)°, \(degrees(high - ideal)) over your ideal range."))
        }
        if let (head, limit) = over(c.maximumHeadwindKph, p.wind.comfortableHeadwindKph) {
            let stretches = stretches(d)
            if let longest = stretches.filter({ $0.wind == .headwind }).max(by: { $0.endKm - $0.startKm < $1.endKm - $1.startKm }) {
                let km = Int((longest.endKm - longest.startKm).rounded())
                let span = stretches.count == 1 ? "all the way" : longest == stretches.last ? "for the last \(km) km"
                    : longest == stretches.first ? "for the first \(km) km" : "for \(km) km from km \(Int(longest.startKm.rounded()))"
                notes.append(.init(.wind, "Headwind \(span)."))
            } else {
                notes.append(.init(.wind, "Headwinds reach \(head) \(kph), over your \(limit) \(kph) limit."))
            }
        }
        if let (cross, limit) = over(c.maximumCrosswindKph, p.wind.comfortableCrosswindKph) {
            notes.append(.init(.wind, "Crosswinds reach \(cross) \(kph), over your \(limit) \(kph) limit."))
        }
        // The API judges gusts by their estimated opposing or sideways part; the raw peak is at least that.
        if over(c.gustExposure?.maximumAdverseKph, p.wind.comfortableGustKph) != nil {
            notes.append(.init(.wind, "Gusts reach \(Int(c.maximumGustKph.rounded())) \(kph), over your \(Int(p.wind.comfortableGustKph.rounded())) \(kph) limit."))
        }
        if let rain = c.precipitationSummary, rain != "dry", rain != "possible" {
            notes.append(.init(.rain, "\(sentence(rain)) forecast, up to \(percent(c.maximumPrecipitationProbability)) chance."))
        }
        if let points = d.recentRides.map({ Int($0.penaltyPoints.rounded()) }), points > 0 {
            notes.append(.init(.other, "You've ridden these roads recently, so it loses \(points) \(points == 1 ? "point" : "points")."))
        }
        if let fit, fit.status != "within_range", Int(fit.deviationKm.rounded()) > 0 {
            notes.append(.init(.other, "\(Int(fit.deviationKm.rounded())) km \(fit.status == "below_range" ? "shorter" : "longer") than your preferred distance."))
        }
        return notes
    }

    /// The API's own sentences, when its response has no preferences to personalise with.
    static func notes(_ drawbacks: [String]) -> [RideDetail.Note] {
        drawbacks.map { text in
            let lower = text.lowercased()
            let kind: RideDetail.Note.Kind = lower.contains("cooler") || lower.contains("warmer") ? .temperature
                : ["headwind", "crosswind", "gust"].contains(where: { lower.contains($0) }) ? .wind : .other
            return RideDetail.Note(kind, text)
        }
    }

    static func departure(_ d: Departure, route: RideBoard.RouteSummary, preferences: Preferences?) -> RideDetail.Departure {
        let hours = d.rideHours.compactMap { hour in
            hour.conditions.map { c in
                RideDetail.Hour(time: hour.start, sky: sky(c), temperatureC: ((c.temperatureC.minimum + c.temperatureC.maximum) / 2).rounded(),
                                windKph: c.averageWindSpeedKph, gustKph: c.maximumGustKph, rainChance: c.maximumPrecipitationProbability)
            }
        }
        return RideDetail.Departure(start: d.departureAt, finish: d.finishAt, score: Int(d.score.rounded()), hours: hours,
                                    windFrom: nil, wind: stretches(d), factors: factors(d, route: route, preferences: preferences))
    }

    /// Each ride hour's stretch of road with its felt wind, merged where it doesn't change.
    static func stretches(_ d: Departure) -> [RideDetail.WindStretch] {
        var stretches: [RideDetail.WindStretch] = []
        var km = 0.0
        for c in d.rideHours.compactMap(\.conditions) where c.distanceKm > 0 {
            let felt = wind(c)
            if stretches.last?.wind == felt { stretches[stretches.count - 1].endKm = km + c.distanceKm }
            else { stretches.append(RideDetail.WindStretch(felt, from: km, to: km + c.distanceKm)) }
            km += c.distanceKm
        }
        return stretches
    }

    // ponytail: metric, en-GB prose; follow the saved display units when You is wired up.
    static let kph = "km/\u{2060}h"

    static func percent(_ fraction: Double) -> String { "\(Int((fraction * 100).rounded()))%" }

    /// "light_showers" → "Light showers".
    static func sentence(_ summary: String) -> String {
        let words = summary.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    static func factors(_ d: Departure, route: RideBoard.RouteSummary, preferences p: Preferences?) -> [RideDetail.Factor] {
        let c = d.conditions, f = d.factors
        func score(_ value: Double) -> Int { Int(value.rounded()) }
        let summary = c.precipitationSummary ?? "dry"
        let rain = switch summary {
        case "dry": "Dry throughout."
        case "possible": "Rain is possible."
        default: "\(sentence(summary)) forecast."
        }
        let gust = Int(c.maximumGustKph.rounded())
        // Comfort counts only gusts against or across the rider (`gustExposure`), so a big one from behind isn't "over".
        let limit = p.map { limit in
            let rounded = Int(limit.wind.comfortableGustKph.rounded())
            return gust <= rounded ? ", under your \(rounded) \(kph) limit"
                : (c.gustExposure?.maximumAdverseKph).map { Int($0.rounded()) <= rounded } == true ? ", mostly from behind"
                : ", over your \(rounded) \(kph) limit"
        } ?? ""
        let ideal = p.map { " Your ideal range is \(Int($0.temperature.comfortMinC.rounded()))–\(Int($0.temperature.comfortMaxC.rounded()))°." } ?? ""
        let felt = wind(c)
        let share: Double? = c.windDistanceFractions.map {
            switch felt { case .tailwind: $0.tailwind; case .crosswind: $0.crosswind; case .headwind: $0.headwind }
        }
        var factors = [
            RideDetail.Factor("Rain", score: score(f.dryness), reason: "\(rain) The highest chance of rain is \(percent(c.maximumPrecipitationProbability))."),
            RideDetail.Factor("Wind", score: score(f.wind), reason: "\(felt.title)\(share.map { " for \(percent($0)) of the distance" } ?? " mostly"). Gusts peak at \(gust) \(kph)\(limit)."),
            RideDetail.Factor("Temperature", score: score(f.temperature), reason: "\(Int(c.temperatureC.minimum.rounded()))–\(Int(c.temperatureC.maximum.rounded()))° along the way.\(ideal)"),
        ]
        if let value = f.clearSkies, let cloud = c.cloudCoverFraction {
            factors.append(RideDetail.Factor("Sky", score: score(value), reason: "\(sky(c).title), about \(percent(cloud.mean)) cloud cover."))
        }
        if let value = f.sunshine, let shares = c.skyConditionDistanceFractions {
            let sunny = (shares["sunny"] ?? 0) + (shares["sunnyIntervals"] ?? 0)
            factors.append(RideDetail.Factor("Sunshine", score: score(value), reason: "Sunny or sunny spells for \(percent(sunny)) of the distance."))
        }
        if let value = f.climbing {
            factors.append(RideDetail.Factor("Climbing", score: score(value), reason: "\(Int(route.ascentM.rounded())) m of climbing over \(Int(route.distanceKm.rounded())) km."))
        }
        if let value = f.distance {
            factors.append(RideDetail.Factor("Distance", score: score(value), reason: "\(Int(route.distanceKm.rounded())) km."))
        }
        return factors.sorted { $0.score > $1.score }
    }
}

// MARK: - Wire types

extension RideBoardLoader {
    struct RouteInfo: Sendable {
        var coordinates: [Coordinate]
        var cycleTravelURL: URL?
    }

    struct SelectionResponse: Decodable {
        struct Selection: Decodable { var routeIds: [String] }
        var selection: Selection
    }

    struct UserResponse: Decodable {
        struct User: Decodable { var version: Int; var settings: Settings? }
        struct Settings: Decodable { var planning: Planning? }
        struct Planning: Decodable { var days: PlanningDays?; var window: PlanningWindow? }
        var user: User
    }

    struct PlanningPatch: Encodable {
        struct Settings: Encodable { var planning: Planning }
        struct Planning: Encodable { var days: PlanningDays; var window: PlanningWindow }
        var expectedVersion: Int
        var settings: Settings
    }

    /// `{kind: "preset", preset}`, `{kind: "range", start, end}` or `{kind: "dates", dates}`.
    struct PlanningDays: Codable, Sendable {
        var kind: String
        var preset: String?
        var start: String?
        var end: String?
        var dates: [String]?

        /// "2026-10-14", in the device's time zone.
        // ponytail: assumes the device and the routes share a time zone.
        static func dates(_ days: [Date]) -> PlanningDays {
            PlanningDays(kind: "dates", dates: days.map {
                let day = Calendar.current.dateComponents([.year, .month, .day], from: $0)
                return String(format: "%04d-%02d-%02d", day.year ?? 0, day.month ?? 0, day.day ?? 0)
            })
        }

        /// Presets as dates the way the extension sends them: the API's "next" starts today, the app's tomorrow.
        var resolved: PlanningDays {
            guard kind == "preset", let pick = preset.flatMap(RideWindow.QuickPick.init) else { return self }
            return .dates(pick.days(from: .now))
        }
    }

    /// `"daylight"` or `{start: "HH:mm", end: "HH:mm"}`.
    struct PlanningWindow: Codable, Sendable {
        var hours: RideWindow.Hours

        init(_ hours: RideWindow.Hours) { self.hours = hours }

        init(from decoder: any Decoder) throws {
            let range = try? decoder.singleValueContainer().decode([String: String].self)
            func minutes(_ key: String) -> Int? {
                let parts = range?[key]?.split(separator: ":").compactMap { Int($0) } ?? []
                return parts.count == 2 ? parts[0] * 60 + parts[1] : nil
            }
            if let leave = minutes("start"), let back = minutes("end") {
                hours = .custom(leave: leave, back: back)
            } else {
                hours = .daylight
            }
        }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.singleValueContainer()
            switch hours {
            case .daylight: try container.encode("daylight")
            case .custom(let leave, let back):
                func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }
                try container.encode(["start": clock(leave), "end": clock(back)])
            }
        }
    }

    struct RecommendationRequest: Encodable {
        struct Riding: Encodable { var window: PlanningWindow }
        var routeIds: [String]
        var days: PlanningDays
        /// Today onwards, for the Ride Window sheet's days.
        var previewDays: Int
        var riding: Riding
    }

    struct SummariesRequest: Encodable { var routeIds: [String] }
    struct SummariesResponse: Decodable { var summaries: [Summary] }
    struct Summary: Decodable { var routeId: String; var lastRiddenOn: String? }

    struct RouteResponse: Decodable {
        struct Route: Decodable { var source: Source? }
        struct Source: Decodable { var providerId: String; var externalId: String }
        var route: Route
    }

    struct GeometryResponse: Decodable {
        struct Geometry: Decodable { var data: String }
        var geometry: Geometry?
    }

    struct Recommendation: Decodable {
        struct Range: Decodable { var dates: [String] }
        struct Day: Decodable {
            var date: String
            var selected: Bool
            var best: Departure?
            var recommendedRouteId: String?
            var availabilityReason: String?
            var until: Date?
            /// A day's daylight is `{sunrise, sunset}`; a route's is an `Interval`.
            var daylight: Sunlight?
            var temperatureMaxC: Double?
        }
        var generatedAt: Date
        var timeZone: String
        var rankings: [RouteResult]
        var unranked: [RouteResult]
        var range: Range?
        var days: [Day]
        var resolvedPreferences: Preferences?
        var weather: Weather?
    }

    /// The comfort settings the ranking used.
    struct Preferences: Decodable {
        struct Temperature: Decodable { var comfortMinC, comfortMaxC: Double }
        struct Wind: Decodable { var comfortableHeadwindKph, comfortableCrosswindKph, comfortableGustKph: Double }
        var temperature: Temperature
        var wind: Wind
    }

    struct Weather: Decodable {
        struct Credit: Decodable { var text: String; var url: URL }
        var attribution: [Credit]?
    }

    struct Interval: Decodable { var start: Date; var end: Date }
    struct Sunlight: Decodable { var sunrise: Date; var sunset: Date }

    struct RouteResult: Decodable {
        var routeId: String
        var routeName: String
        var distanceKm: Double
        var ascentM: Double?
        var estimatedDurationMinutes: Double
        var daylight: Interval?
        var effectiveWindow: Interval?
        var status: String
        var best: Departure?
        var alternatives: [Departure]
        var distanceFit: DistanceFit?

        struct DistanceFit: Decodable { var status: String; var deviationKm: Double }
    }

    struct Departure: Decodable {
        struct Factors: Decodable {
            var distance, climbing, sunshine, clearSkies: Double?
            var temperature, wind, dryness: Double
        }
        struct Standards: Decodable { var status: String }
        struct Hour: Decodable { var start: Date; var conditions: Conditions? }
        struct RecentRides: Decodable { var penaltyPoints: Double }
        var departureAt: Date
        var finishAt: Date
        var score: Double
        var factors: Factors
        var standards: Standards
        var conditions: Conditions
        var rideHours: [Hour]
        var drawbacks: [String]
        var recentRides: RecentRides?
    }

    struct Conditions: Decodable {
        struct Range: Decodable { var minimum, maximum: Double }
        struct Shares: Decodable { var headwind, tailwind, crosswind: Double }
        struct Cloud: Decodable { var mean: Double }
        struct GustExposure: Decodable { var maximumAdverseKph: Double }
        var temperatureC: Range
        var averageWindSpeedKph: Double
        var averageHeadwindKph: Double
        var averageTailwindKph: Double
        var averageCrosswindKph: Double
        var maximumGustKph: Double
        var maximumPrecipitationProbability: Double
        var distanceKm: Double
        var windDistanceFractions: Shares?
        var precipitationSummary: String?
        var skyConditionDistanceFractions: [String: Double]?
        var cloudCoverFraction: Cloud?
        var maximumHeadwindKph: Double?
        var maximumCrosswindKph: Double?
        var gustExposure: GustExposure?
    }
}

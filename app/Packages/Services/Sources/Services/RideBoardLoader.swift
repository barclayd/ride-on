import Foundation
import Models
import Engine

/// Builds the Rides screen from the API (docs/api.md, docs/planning-api.md): the shortlist saved
/// in the extension, ranked across the saved planning days, with each route's source and geometry.
public enum RideBoardLoader {
    /// `nil` when nothing is shortlisted. A `window` from the Ride Window sheet is saved as the
    /// planning choice (docs/planning-api.md, "Saved planning"); without one, the saved choice is used.
    public static func load(window: RideWindow? = nil) async throws -> RideBoard? {
        guard let session = RideOnSession.shared.credentials else { return nil }
        let result = try await RideBoardRepository.shared.refresh(session: session.id, account: session.accountID,
                                                                  window: window, force: true)
        return try result.board()
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

    // MARK: Mapping

    static func board(from response: Recommendation, routes: [String: RouteInfo], summaries: [Summary], units: ProseUnits = .init(nil, nil)) -> RideBoard {
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
                                      lastRidden: lastRidden[id], change: change(best), pointsLost: best.pointsLost?.compactMapValues(\.self) ?? [:],
                                      recommendationRef: best.recommendationRef)
            let others = ([result.best].compactMap { $0 } + result.alternatives).filter { $0.departureAt != best.departureAt }
            let preferences = response.resolvedPreferences
            details[pick.id] = RideDetail(pick: pick, changeSince: best.previous?.generatedAt,
                                          notes: preferences.map { notes(best, fit: result.distanceFit, preferences: $0, units: units) } ?? notes(best.drawbacks),
                                          elevation: [],
                                          departures: ([best] + others).prefix(4).map {
                                              departure($0, route: route, preferences: preferences, units: units, timeZone: calendar.timeZone)
                                          })
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
        var board = RideBoard(window: DateInterval(start: start, end: end), generatedAt: response.generatedAt,
                         picks: picks, days: days, forecast: forecast, unfit: unfit, details: details,
                         credits: response.weather?.attribution?.map { RideBoard.Credit(text: $0.text, url: $0.url) } ?? [],
                         scoredWith: response.resolvedPreferences.map {
                             RideBoard.Comfort(temperatureC: $0.temperature.comfortMinC...$0.temperature.comfortMaxC,
                                               headwindKph: $0.wind.comfortableHeadwindKph, crosswindKph: $0.wind.comfortableCrosswindKph)
                         })
        board.timeZone = response.timeZone
        board.expired = response.expired ?? false
        return board
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
    static func notes(_ d: Departure, fit: RouteResult.DistanceFit?, preferences p: Preferences, units u: ProseUnits) -> [RideDetail.Note] {
        let c = d.conditions
        /// Value and limit in display units, when the rounded value is still over the limit.
        func over(_ value: Double?, _ limit: Double, _ display: (Double) -> Int) -> (value: Int, limit: Int)? {
            guard let value, display(value) > display(limit) else { return nil }
            return (display(value), display(limit))
        }
        func degrees(_ n: Int) -> String { n == 1 ? "a degree" : "\(n) degrees" }
        var notes: [RideDetail.Note] = []
        let low = u.degrees(c.temperatureC.minimum), ideal = u.degrees(p.temperature.comfortMinC)
        if low < ideal {
            // An hour's temperature is a range over its stretch of road, so no "starts at".
            let early = d.rideHours.first?.conditions?.temperatureC.minimum == c.temperatureC.minimum ? " in the first hour" : ""
            notes.append(.init(.temperature, "Down to \(low)°\(early), \(degrees(ideal - low)) under your ideal range."))
        }
        if let (high, ideal) = over(c.temperatureC.maximum, p.temperature.comfortMaxC, u.degrees) {
            notes.append(.init(.temperature, "Up to \(high)°, \(degrees(high - ideal)) over your ideal range."))
        }
        // Comfort settings, not limits; where along the road isn't known, so no "for the last 9 km".
        if let (head, comfort) = over(c.maximumHeadwindKph, p.wind.comfortableHeadwindKph, u.speedValue) {
            notes.append(.init(.wind, "Headwinds reach \(head) \(u.speedUnit), more than the \(comfort) \(u.speedUnit) you're comfortable with."))
        }
        if let (cross, comfort) = over(c.maximumCrosswindKph, p.wind.comfortableCrosswindKph, u.speedValue) {
            notes.append(.init(.wind, "Crosswinds reach \(cross) \(u.speedUnit), more than the \(comfort) \(u.speedUnit) you're comfortable with."))
        }
        if let maximum = p.minimumStandards?.maximumGustKph, let (gust, limit) = over(c.maximumGustKph, maximum, u.speedValue) {
            notes.append(.init(.wind, "Gusts reach \(gust) \(u.speedUnit), over your \(limit) \(u.speedUnit) limit."))
        }
        if let rain = c.precipitationSummary, rain != "dry", rain != "possible" {
            notes.append(.init(.rain, "\(sentence(rain)) forecast. The highest hourly chance is \(percent(c.maximumPrecipitationProbability))."))
        }
        if let points = d.recentRides.map({ Int($0.penaltyPoints.rounded()) }), points > 0 {
            notes.append(.init(.other, "You've ridden these roads recently, so it loses \(points) \(points == 1 ? "point" : "points")."))
        }
        if let fit, fit.status != "within_range", u.distanceValue(fit.deviationKm) > 0 {
            notes.append(.init(.other, "\(u.distance(fit.deviationKm)) \(fit.status == "below_range" ? "shorter" : "longer") than your preferred distance."))
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

    static func departure(_ d: Departure, route: RideBoard.RouteSummary, preferences: Preferences?, units: ProseUnits,
                          timeZone: TimeZone = .current) -> RideDetail.Departure {
        let hours = d.rideHours.compactMap { hour in
            hour.conditions.map { c in
                RideDetail.Hour(time: hour.start, sky: sky(c), temperatureC: ((c.temperatureC.minimum + c.temperatureC.maximum) / 2).rounded(),
                                windKph: c.averageWindSpeedKph, gustKph: c.maximumGustKph, rainChance: c.maximumPrecipitationProbability)
            }
        }
        return RideDetail.Departure(start: d.departureAt, finish: d.finishAt, score: Int(d.score.rounded()), hours: hours,
                                    windFrom: d.conditions.windFromDegrees.map(compass), wind: stretches(d),
                                    factors: factors(d, route: route, preferences: preferences, units: units),
                                    sky: skyBreakdown(d),
                                    windBreakdown: windBreakdown(d, route: route, preferences: preferences, units: units, timeZone: timeZone))
    }

    // MARK: Sky and wind on the ride (the extension's sky chip and wind panel: extension/ui/format.ts, wind.ts)

    /// `nil` when sunshine isn't weighed, isn't forecast, or the sky is showers or night alone.
    static func skyBreakdown(_ d: Departure) -> RideDetail.SkyBreakdown? {
        guard let assessed = d.sunshineAssessment, assessed.status != "unavailable" else { return nil }
        // Before `skyConditionShares`, an hour with a gap has no shares: count it all as not forecast.
        let hours = d.rideHours.compactMap { hour -> (km: Double, kinds: [RideDetail.SkyBreakdown.Kind: Double])? in
            guard let c = hour.conditions, c.distanceKm > 0 else { return nil }
            return (c.distanceKm, skyKinds(c) ?? [.unknown: 1])
        }
        let km = hours.reduce(0) { $0 + $1.km }
        let mean = km > 0 ? Dictionary(uniqueKeysWithValues: RideDetail.SkyBreakdown.Kind.allCases.map { kind in
            (kind, hours.reduce(0) { $0 + ($1.kinds[kind] ?? 0) * $1.km } / km)
        }) : nil
        guard let ride = skyKinds(d.conditions) ?? mean else { return nil }
        return .make(ride: ride, hours: hours,
                     categories: d.conditions.skyConditionShares ?? d.conditions.skyConditionDistanceFractions ?? [:],
                     partial: assessed.status != "complete" || assessed.unknownDistanceFraction > 0)
    }

    /// Cloud, overcast, mist, showers and night all count as cloud.
    static func skyKinds(_ c: Conditions) -> [RideDetail.SkyBreakdown.Kind: Double]? {
        guard let f = c.skyConditionShares ?? c.skyConditionDistanceFractions else { return nil }
        let named = ["sunny", "sunnyIntervals", "unknown"]
        return [.sunny: f["sunny"] ?? 0, .sunnyIntervals: f["sunnyIntervals"] ?? 0, .unknown: f["unknown"] ?? 0,
                .cloud: f.filter { !named.contains($0.key) }.values.reduce(0, +)]
    }

    /// The API's wind stretches; before them, each ride hour; with neither, the whole ride's summary.
    static func windBreakdown(_ d: Departure, route: RideBoard.RouteSummary, preferences p: Preferences?, units u: ProseUnits,
                              timeZone: TimeZone) -> RideDetail.WindBreakdown {
        typealias Wind = RideDetail.WindBreakdown
        let metres = d.windStretches?.last?.toM ?? 0
        let stretches: [Wind.Stretch]
        if let wire = d.windStretches, metres > 0 {
            stretches = wire.map {
                Wind.Stretch(effect($0.effect), from: $0.fromM / metres, to: $0.toM / metres, fromDegrees: $0.windFromDegrees,
                             kph: $0.averageWindSpeedKph, adverseGustKph: $0.maximumAdverseGustKph, start: $0.startAt, end: $0.endAt)
            }
        } else {
            let hours = d.rideHours.compactMap { hour in hour.conditions.flatMap { $0.distanceKm > 0 ? (hour, $0) : nil } }
            let km = hours.reduce(0) { $0 + $1.1.distanceKm }
            var from = 0.0
            stretches = km > 0 ? hours.map { hour, c in
                let share = c.distanceKm / km
                defer { from += share }
                return span(c, from: from, to: from + share, start: hour.start, end: hour.end ?? min(d.finishAt, hour.start.addingTimeInterval(3600)))
            } : [span(d.conditions, from: 0, to: 1, start: d.departureAt, end: d.finishAt)]
        }
        let roundTrip = Wind.isRoundTrip(route.coordinates)
        var style = Date.FormatStyle.dateTime.hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits)
        style.timeZone = timeZone
        let gusts = Wind.gusts(peakKph: d.conditions.maximumGustKph, adverseKph: d.conditions.gustExposure?.maximumAdverseKph,
                               comfortKph: p?.wind.comfortableGustKph, limitKph: p?.minimumStandards?.maximumGustKph,
                               stretches: stretches, roundTrip: roundTrip, speed: u.speed, clock: { $0.formatted(style) })
        return Wind(stretches: stretches, averageKph: d.conditions.averageWindSpeedKph, gusts: gusts, roundTrip: roundTrip,
                    exact: d.windStretches?.isEmpty == false && metres > 0)
    }

    static func effect(_ wire: String) -> RideDetail.WindBreakdown.Effect {
        switch wire {
        case "tailwind": .tailwind
        case "crosswind": .crosswind
        case "headwind": .headwind
        default: .light
        }
    }

    /// A ride hour, or the whole ride, as one stretch: its main effect, with how much of it each covers.
    static func span(_ c: Conditions, from: Double, to: Double, start: Date, end: Date) -> RideDetail.WindBreakdown.Stretch {
        typealias Wind = RideDetail.WindBreakdown
        let effects: [(Wind.Effect, Double)]
        if c.averageWindSpeedKph < Wind.namedKph {
            effects = [(.light, 1)]
        } else if let f = c.windDistanceFractions {
            effects = [(.tailwind, f.tailwind), (.crosswind, f.crosswind), (.headwind, f.headwind)]
        } else {
            effects = [(.tailwind, c.averageTailwindKph), (.crosswind, c.averageCrosswindKph), (.headwind, c.averageHeadwindKph)]
        }
        // The first largest wins, like the extension.
        let main = effects.dropFirst().reduce(effects[0]) { $1.1 > $0.1 ? $1 : $0 }.0
        let parts = c.windDistanceFractions != nil || c.averageWindSpeedKph < Wind.namedKph
            ? Dictionary(uniqueKeysWithValues: effects) : [main: 1]
        return Wind.Stretch(main, from: from, to: to, fromDegrees: c.windFromDegrees, kph: c.averageWindSpeedKph,
                            adverseGustKph: c.gustExposure?.maximumAdverseKph, start: start, end: end, parts: parts)
    }

    /// 248° → "west-south-west".
    static func compass(_ degrees: Double) -> String {
        let points = ["north", "north-north-east", "north-east", "east-north-east", "east", "east-south-east", "south-east", "south-south-east",
                      "south", "south-south-west", "south-west", "west-south-west", "west", "west-north-west", "north-west", "north-north-west"]
        return points[Int((degrees / 22.5).rounded()) % 16]
    }

    /// The rounded score's move since the day's earlier comparable forecast; `nil` under a point.
    static func change(_ d: Departure) -> Int? {
        guard let previous = d.previous else { return nil }
        let change = Int(d.score.rounded()) - Int(previous.score.rounded())
        return change == 0 ? nil : change
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

    static func percent(_ fraction: Double) -> String { "\(Int((fraction * 100).rounded()))%" }

    /// "light_showers" → "Light showers".
    static func sentence(_ summary: String) -> String {
        let words = summary.replacingOccurrences(of: "_", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    static func factors(_ d: Departure, route: RideBoard.RouteSummary, preferences p: Preferences?, units u: ProseUnits) -> [RideDetail.Factor] {
        let c = d.conditions, f = d.factors
        func score(_ value: Double) -> Int { Int(value.rounded()) }
        let summary = c.precipitationSummary ?? "dry"
        let rain = switch summary {
        case "dry": "Dry throughout."
        case "possible": "Rain is possible."
        default: "\(sentence(summary)) forecast."
        }
        // Only a hard limit is a "limit"; gust comfort weighs the estimated opposing part, not this raw peak.
        let limit = (p?.minimumStandards?.maximumGustKph).map { maximum in
            u.speedValue(c.maximumGustKph) > u.speedValue(maximum) ? ", over your \(u.speed(maximum)) limit" : ", within your \(u.speed(maximum)) limit"
        } ?? ""
        let ideal = p.map { " Your ideal range is \(u.degrees($0.temperature.comfortMinC))–\(u.degrees($0.temperature.comfortMaxC))°." } ?? ""
        let felt = wind(c)
        let share: Double? = c.windDistanceFractions.map {
            switch felt { case .tailwind: $0.tailwind; case .crosswind: $0.crosswind; case .headwind: $0.headwind }
        }
        var factors = [
            RideDetail.Factor("Rain", score: score(f.dryness), reason: "\(rain) The highest hourly chance of rain is \(percent(c.maximumPrecipitationProbability))."),
            RideDetail.Factor("Wind", score: score(f.wind), reason: "\(felt.title)\(share.map { " for \(percent($0)) of the distance" } ?? " mostly"). Gusts peak at \(u.speed(c.maximumGustKph))\(limit)."),
            RideDetail.Factor("Temperature", score: score(f.temperature), reason: "\(u.degrees(c.temperatureC.minimum))–\(u.degrees(c.temperatureC.maximum))° along the way.\(ideal)"),
        ]
        if let value = f.clearSkies, let cloud = c.cloudCoverFraction {
            factors.append(RideDetail.Factor("Sky", score: score(value), reason: "\(sky(c).title), about \(percent(cloud.mean)) cloud cover."))
        }
        if let value = f.sunshine, let shares = c.skyConditionDistanceFractions {
            let sunny = (shares["sunny"] ?? 0) + (shares["sunnyIntervals"] ?? 0)
            factors.append(RideDetail.Factor("Sunshine", score: score(value), reason: "Sunny or sunny spells for \(percent(sunny)) of the distance."))
        }
        if let value = f.climbing {
            factors.append(RideDetail.Factor("Climbing", score: score(value), reason: "\(u.height(route.ascentM)) of climbing over \(u.distance(route.distanceKm))."))
        }
        if let value = f.distance {
            factors.append(RideDetail.Factor("Distance", score: score(value), reason: "\(u.distance(route.distanceKm))."))
        }
        return factors.sorted { $0.score > $1.score }
    }
}

// MARK: - Wire types

extension RideBoardLoader {
    struct RouteInfo: Codable, Sendable {
        var coordinates: [Coordinate]
        var cycleTravelURL: URL?
    }

    struct SelectionResponse: Decodable, Sendable {
        struct Selection: Decodable, Sendable { var routeIds: [String]; var version: Int? }
        var selection: Selection
    }

    struct UserResponse: Decodable, Sendable {
        struct User: Decodable, Sendable { var id: String?; var version: Int; var settings: Settings? }
        struct Settings: Decodable, Sendable { var timeZone: String?; var planning: Planning?; var units: RiderSettings.Units?; var display: RiderSettings.Display? }
        struct Planning: Decodable, Sendable { var days: PlanningDays?; var window: PlanningWindow? }
        var user: User
    }

    struct PlanningPatch: Encodable, Sendable {
        struct Settings: Encodable, Sendable { var planning: Planning }
        struct Planning: Encodable, Sendable { var days: PlanningDays; var window: PlanningWindow }
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

        /// "2026-10-14", in the supplied planning calendar's time zone.
        static func dates(_ days: [Date], calendar: Calendar = .current) -> PlanningDays {
            PlanningDays(kind: "dates", dates: days.map {
                let day = calendar.dateComponents([.year, .month, .day], from: $0)
                return String(format: "%04d-%02d-%02d", day.year ?? 0, day.month ?? 0, day.day ?? 0)
            })
        }

        /// Presets as dates the way the extension sends them: the API's "next" starts today, the app's tomorrow.
        var resolved: PlanningDays { resolved(at: .now, calendar: .current) }

        func resolved(at date: Date, calendar: Calendar) -> PlanningDays {
            guard kind == "preset", let pick = preset.flatMap(RideWindow.QuickPick.init) else { return self }
            return .dates(pick.days(from: date, calendar: calendar), calendar: calendar)
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

    struct RecommendationRequest: Encodable, Sendable {
        struct Riding: Encodable, Sendable { var window: PlanningWindow }
        var routeIds: [String]
        var days: PlanningDays
        /// Today onwards, for the Ride Window sheet's days.
        var previewDays: Int
        var riding: Riding
    }

    struct SummariesRequest: Encodable, Sendable { var routeIds: [String] }
    struct SummariesResponse: Decodable, Sendable { var summaries: [Summary]; var historyRevision: Int? }
    struct Summary: Codable, Sendable { var routeId: String; var lastRiddenOn: String? }

    struct RouteResponse: Decodable, Sendable {
        struct Route: Decodable, Sendable { var version: Int?; var source: Source? }
        struct Source: Decodable, Sendable { var providerId: String; var externalId: String }
        var route: Route
    }

    struct GeometryResponse: Decodable, Sendable {
        struct Geometry: Decodable, Sendable { var data: String }
        var version: Int?
        var geometry: Geometry?
    }

    struct Recommendation: Decodable, Sendable {
        struct Range: Decodable, Sendable { var dates: [String] }
        struct Day: Decodable, Sendable {
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
        var expired: Bool?
        var algorithmVersion: String?
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
    struct Preferences: Decodable, Sendable {
        struct Temperature: Decodable, Sendable { var comfortMinC, comfortMaxC: Double }
        struct Wind: Decodable, Sendable { var comfortableHeadwindKph, comfortableCrosswindKph, comfortableGustKph: Double }
        struct Standards: Decodable, Sendable { var maximumGustKph: Double? }
        var temperature: Temperature
        var wind: Wind
        var minimumStandards: Standards?
    }

    /// The units the notes and factor reasons are written in: the rider's saved choices, each on its own,
    /// else the region's, as the rest of the app decides.
    struct ProseUnits: Sendable {
        var fahrenheit = false, mph = false, miles = false

        static let metric = ProseUnits()

        func degrees(_ c: Double) -> Int { Int((fahrenheit ? c * 1.8 + 32 : c).rounded()) }
        func speedValue(_ kph: Double) -> Int { Int((mph ? kph / 1.609344 : kph).rounded()) }
        /// "km/h" that never wraps after the slash (U+2060 word joiner).
        var speedUnit: String { mph ? "mph" : "km/\u{2060}h" }
        func speed(_ kph: Double) -> String { "\(speedValue(kph)) \(speedUnit)" }
        func distanceValue(_ km: Double) -> Int { Int((miles ? km / 1.609344 : km).rounded()) }
        func distance(_ km: Double) -> String { "\(distanceValue(km)) \(miles ? "mi" : "km")" }
        func height(_ m: Double) -> String { "\(Int((miles ? m / 0.3048 : m).rounded())) \(miles ? "ft" : "m")" }
    }

    struct Weather: Decodable, Sendable {
        struct Credit: Decodable, Sendable { var text: String; var url: URL }
        var refreshAt: Date?
        var attribution: [Credit]?
    }

    struct Interval: Decodable, Sendable { var start: Date; var end: Date }
    struct Sunlight: Decodable, Sendable { var sunrise: Date; var sunset: Date }

    struct RouteResult: Decodable, Sendable {
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

        struct DistanceFit: Decodable, Sendable { var status: String; var deviationKm: Double }
    }

    struct Departure: Decodable, Sendable {
        struct Factors: Decodable, Sendable {
            var distance, climbing, sunshine, clearSkies: Double?
            var temperature, wind, dryness: Double
        }
        struct Standards: Decodable, Sendable { var status: String }
        struct Hour: Decodable, Sendable { var start: Date; var end: Date?; var conditions: Conditions? }
        struct WindStretch: Decodable, Sendable {
            var fromM, toM: Double
            var startAt, endAt: Date
            /// `tailwind`, `crosswind`, `headwind` or `light` (under 10 km/h).
            var effect: String
            var windFromDegrees: Double?
            var averageWindSpeedKph: Double
            var maximumAdverseGustKph: Double?
        }
        struct SunshineAssessment: Decodable, Sendable {
            /// `complete`, `partial` or `unavailable`.
            var status: String
            var unknownDistanceFraction: Double
        }
        struct RecentRides: Decodable, Sendable { var penaltyPoints: Double }
        struct Previous: Decodable, Sendable { var score: Double; var generatedAt: Date }
        var departureAt: Date
        var finishAt: Date
        var score: Double
        var factors: Factors
        var standards: Standards
        var conditions: Conditions
        var rideHours: [Hour]
        /// Covers the ride in order; empty when coverage is incomplete. Absent before API v0.29.0.
        var windStretches: [WindStretch]?
        /// `nil` when sunshine has no weight.
        var sunshineAssessment: SunshineAssessment?
        var drawbacks: [String]
        var recentRides: RecentRides?
        /// Null values: the factor is inactive or lacks evidence. Absent before API v0.25.0.
        var pointsLost: [String: Double?]?
        var previous: Previous?
        /// `nil` when the API couldn't save this ride's assessment for tracking.
        var recommendationRef: String?
    }

    struct Conditions: Decodable, Sendable {
        struct Range: Decodable, Sendable { var minimum, maximum: Double }
        struct Shares: Decodable, Sendable { var headwind, tailwind, crosswind: Double }
        struct Cloud: Decodable, Sendable { var mean: Double }
        struct GustExposure: Decodable, Sendable { var maximumAdverseKph: Double }
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
        /// The same shares plus `unknown`, kept when part of the ride isn't forecast.
        var skyConditionShares: [String: Double]?
        var cloudCoverFraction: Cloud?
        var maximumHeadwindKph: Double?
        var maximumCrosswindKph: Double?
        var gustExposure: GustExposure?
        var windFromDegrees: Double?
    }
}

extension RideBoardLoader.ProseUnits {
    init(_ units: RiderSettings.Units?, _ display: RiderSettings.Display?, locale: Locale = .current) {
        let us = locale.measurementSystem == .us
        self.init(fahrenheit: units.map { $0.temperature == "F" } ?? (UnitTemperature(forLocale: locale, usage: .weather) == .fahrenheit),
                  mph: units.map { $0.windSpeed == "mph" } ?? us,
                  miles: display.map { $0.unit == "mi" } ?? us)
    }
}

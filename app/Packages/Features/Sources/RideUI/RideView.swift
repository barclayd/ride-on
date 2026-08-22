import SwiftUI
import SwiftData
import Models
import Engine
import Services
import DesignSystem
import Router
import SharedUI

/// DESIGN-SYSTEM.md §9 "Ride": a day selector in the nav bar's leading slot
/// (any of the next 10 forecastable days), a hero `RideCard` for the
/// top-ranked route with every other route in a ranked list below, a compact
/// top-bar capsule for the day's bike/hours/intent/back-by inputs, and a
/// tap-to-open breakdown sheet. Hourly weather is fetched per route start
/// (the day cache dedupes nearby starts); the shared best window on the
/// selected day is picked by `BestWindowScan` and every route is scored
/// inside it.
public struct RideView: View {
    public var namespace: Namespace.ID

    @Environment(\.services) private var services
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.navigate) private var navigate
    @Query(sort: \RouteModel.createdAt) private var routeModels: [RouteModel]
    @Query private var savedPlaces: [SavedPlaceModel]
    @Query private var rideLogModels: [RideLogModel]

    private enum WeatherLoad {
        case loading
        case failed
        case loaded([UUID: [HourlyWeather]])

        // Keys the phase-swap animation: the spinner -> content switch on
        // every launch should materialize, not hard-cut.
        var phase: Int {
            switch self {
            case .loading: 0
            case .failed: 1
            case .loaded: 2
            }
        }
    }

    @State private var weatherLoad: WeatherLoad = .loading
    @State private var loadedDay: Date?
    /// Which of the next 10 forecastable days is on screen. Ephemeral by
    /// design: every launch starts on Today, and a day rollover while
    /// backgrounded snaps back to Today.
    @State private var selectedDayOffset = 0
    @State private var backBy: Date?
    @State private var deviceLocation: Coordinate?
    @State private var isContextEditorPresented = false
    @State private var breakdownItem: BreakdownItem?
    @State private var isLocationPrimingPresented = false
    @State private var travelMinutesByRouteID: [UUID: Int] = [:]
    @ScaledMetric(relativeTo: .largeTitle) private var restDaySymbolSize: CGFloat = 40

    // A route only takes the hero slot when the selected day's conditions
    // grade as worth riding (tier C or better) — otherwise the "rest day"
    // card takes it, with the ranked list still below.

    public init(namespace: Namespace.ID) {
        self.namespace = namespace
    }

    public var body: some View {
        Group {
            if routeModels.isEmpty {
                ContentUnavailableView(
                    "No Routes Yet",
                    systemImage: "bicycle",
                    description: Text("Import a GPX route from the Routes tab to get personalized recommendations.")
                )
            } else {
                switch weatherLoad {
                case .loading:
                    ProgressView()
                case .failed:
                    weatherUnavailable
                case .loaded(let hoursByRouteID):
                    rankedContent(hoursByRouteID: hoursByRouteID)
                }
            }
        }
        .animation(Motion.panelMaterialize, value: weatherLoad.phase)
        .navigationTitle(titleLabel)
        .task(id: "\(selectedDayOffset)|" + routeModels.map(\.id.uuidString).joined()) {
            await loadWeather()
        }
        .task(id: preferencesStore.hasPrimedLocationPermission) {
            // DESIGN-SYSTEM.md §9: location is primed on first Ride entry.
            // Until primed, don't touch CoreLocation — the system prompt may
            // only ever follow the priming sheet's Allow.
            guard preferencesStore.hasPrimedLocationPermission else {
                isLocationPrimingPresented = true
                return
            }
            await loadTravelTimes(requestingPermission: false)
        }
        .onChange(of: scenePhase) { _, phase in
            // Day rollover while backgrounded: yesterday's ranking is stale
            // and yesterday's "Tomorrow" is today — snap back to Today.
            if phase == .active, let loadedDay, !Calendar.current.isDate(loadedDay, inSameDayAs: .now) {
                selectedDayOffset = 0
                Task { await loadWeather() }
            }
        }
        // Day selector leads, ride context trails — both plain toolbar
        // items riding the system's toolbar glass (DESIGN-SYSTEM.md §2:
        // glass is chrome).
        .toolbar {
            ToolbarItem(placement: .navigation) {
                daySelector
            }
            ToolbarItem(placement: .primaryAction) {
                ContextToolbarButton(
                    bike: preferencesStore.todaySettings.bike,
                    hoursAvailable: preferencesStore.todaySettings.hoursAvailable,
                    intent: preferencesStore.todaySettings.intent,
                    backBy: backBy
                ) {
                    isContextEditorPresented = true
                }
            }
        }
        .sheet(isPresented: $isContextEditorPresented) {
            @Bindable var store = preferencesStore
            ContextEditorSheet(
                hoursAvailable: $store.todaySettings.hoursAvailable,
                intent: $store.todaySettings.intent,
                bike: $store.todaySettings.bike,
                backBy: $backBy
            )
        }
        .sheet(item: $breakdownItem) { item in
            BreakdownSheet(
                rankedRide: item.rankedRide,
                chips: item.chips,
                loadRecommendation: { await loadRecommendation(for: item.rankedRide) },
                onViewRoute: { routeID in
                    breakdownItem = nil
                    navigate(.routeDetail(routeID: routeID))
                },
                onSelectDay: { date in
                    breakdownItem = nil
                    jumpSelector(to: date)
                }
            )
        }
        .sheet(isPresented: $isLocationPrimingPresented) {
            PermissionPrimingSheet(
                symbol: "location.fill",
                title: "Find Rides Near You",
                message: "Ride On uses your location to find nearby routes and estimate travel time to the start.",
                onAllow: {
                    preferencesStore.hasPrimedLocationPermission = true
                    Task { await loadTravelTimes(requestingPermission: true) }
                },
                onNotNow: { preferencesStore.hasPrimedLocationPermission = true }
            )
        }
    }

    // MARK: - Day selection

    /// Stock `Menu` + inline `Picker` so selection gets the system checkmark
    /// for free without a nested "Day" submenu. The label is a bare calendar
    /// glyph — the large title already names the selected day. Only the next
    /// 10 days appear — the bound is WeatherKit's hour-level forecast range,
    /// not a UI choice.
    private var daySelector: some View {
        Menu {
            Picker("Day", selection: $selectedDayOffset) {
                ForEach(0..<LiveWeatherProvider.forecastDays, id: \.self) { offset in
                    Text(dayLabel(offset: offset)).tag(offset)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Image(systemName: "calendar")
        }
        .accessibilityLabel("Ride day: \(dayLabel(offset: selectedDayOffset)). Double tap to pick another day.")
        .accessibilityIdentifier("ride-day-selector")
    }

    /// "Today", "Tomorrow", then locale-aware weekday + day number
    /// ("Thursday 28") — weekday alone is ambiguous once the 10-day span
    /// wraps past a week.
    private func dayLabel(offset: Int) -> String {
        switch offset {
        case 0: String(localized: "Today")
        case 1: String(localized: "Tomorrow")
        default: day(at: offset).formatted(.dateTime.weekday(.wide).day())
        }
    }

    /// The large title adds the month ("Thursday 28 August") — with the
    /// selector reduced to a glyph, the title is the only place the full
    /// date appears.
    private var titleLabel: String {
        switch selectedDayOffset {
        case 0, 1: dayLabel(offset: selectedDayOffset)
        default: day(at: selectedDayOffset).formatted(.dateTime.weekday(.wide).day().month(.wide))
        }
    }

    private func day(at offset: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: offset, to: .now) ?? .now
    }

    private func jumpSelector(to date: Date) {
        let calendar = Calendar.current
        let offset = calendar.dateComponents([.day], from: calendar.startOfDay(for: .now), to: calendar.startOfDay(for: date)).day ?? 0
        selectedDayOffset = max(0, min(offset, LiveWeatherProvider.forecastDays - 1))
    }

    // MARK: - Ranked content

    private func rankedContent(hoursByRouteID: [UUID: [HourlyWeather]]) -> some View {
        let ranking = windowRanking(hoursByRouteID: hoursByRouteID)
        let ranked = ranking?.ranked ?? []
        let heroRide = ranked.first.flatMap { RideTier(score: $0.score).isWorthRiding ? $0 : nil }
        let windowStart = ranking?.start

        return ScrollView {
            VStack(spacing: 16) {
                if let heroRide {
                    hero(for: heroRide, hoursByRouteID: hoursByRouteID, windowStart: windowStart)
                } else {
                    restDayCard
                }

                let listRides = heroRide == nil ? ranked : Array(ranked.dropFirst())
                ForEach(listRides, id: \.route.id) { rankedRide in
                    if let model = routeModels.first(where: { $0.id == rankedRide.route.id }) {
                        RankedRouteRow(
                            model: model,
                            score: rankedRide.score,
                            stats: statsLine(for: model),
                            weather: windowStart.flatMap { hoursByRouteID[model.id]?.snapshot(at: $0) }
                        ) {
                            breakdownItem = breakdownItem(for: rankedRide, hoursByRouteID: hoursByRouteID, windowStart: windowStart)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .refreshable { await loadWeather() }
    }

    @ViewBuilder
    private func hero(for rankedRide: RankedRide, hoursByRouteID: [UUID: [HourlyWeather]], windowStart: Date?) -> some View {
        if let model = routeModels.first(where: { $0.id == rankedRide.route.id }) {
            let weather = windowStart.flatMap { hoursByRouteID[model.id]?.snapshot(at: $0) }
            RideCard(
                routeID: model.id,
                routeName: model.name,
                coordinates: model.coordinates,
                chips: chips(for: rankedRide, weather: weather, windowStart: windowStart),
                sky: weather?.sky ?? .sunny,
                score: rankedRide.score,
                stats: statsLine(for: model)
            )
            .frame(height: 420)
            .onTapGesture {
                breakdownItem = breakdownItem(for: rankedRide, hoursByRouteID: hoursByRouteID, windowStart: windowStart)
            }
            .matchedTransitionSource(id: model.id, in: namespace)
        }
    }

    private var restDayCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "leaf")
                .font(.system(size: restDaySymbolSize))
                .foregroundStyle(.secondary)
            Text("Take a Rest Day")
                .font(.title2.bold())
            Text(selectedDayOffset == 0
                ? "Nothing in your routes fits today's conditions and time budget well. Adjust your plans or check back tomorrow."
                : "Nothing in your routes fits the conditions and time budget well that day. Try picking a different day.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .frame(minHeight: 260)
        .background(.regularMaterial, in: .rect(cornerRadius: CornerRadius.card))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("rest-day-card")
    }

    private var weatherUnavailable: some View {
        ContentUnavailableView {
            Label("Weather Unavailable", systemImage: "cloud.slash")
        } description: {
            Text("Recommendations need a forecast for the selected day. Check your connection and try again.")
        } actions: {
            Button("Retry") {
                Task { await loadWeather() }
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - Data

    /// The rider's location for travel purposes: device fix, else the first
    /// saved place. `nil` means no travel chips and zero travel distance in
    /// the time-budget factor — a missing chip is fine, an error isn't.
    private var travelOrigin: Coordinate? {
        deviceLocation ?? savedPlaces.first?.coordinate
    }

    private var rideLogs: [RideLog] {
        rideLogModels.compactMap { $0.asRideLog() }
    }

    private func scorer(routes: [Route]) -> WeightedScorer {
        Recommendations.scorer(
            preferences: preferencesStore.preferences,
            rideLogs: rideLogs,
            allRoutes: routes,
            weights: preferencesStore.weights
        )
    }

    /// One shared best window on the selected day, every route ranked
    /// inside it — same rider inputs and start location per route (travel
    /// distance must stay rider -> route start), each route against its own
    /// forecast. Routes whose forecast fetch failed are skipped rather than
    /// ranked against someone else's weather.
    private func windowRanking(hoursByRouteID: [UUID: [HourlyWeather]]) -> BestWindowScan.WindowRanking? {
        let routes = routeModels.map { $0.asRoute() }
        let settings = preferencesStore.todaySettings
        return Recommendations.windowRanking(
            day: day(at: selectedDayOffset),
            routes: routes,
            hoursByRouteID: hoursByRouteID,
            ridingWindowMinutes: preferencesStore.preferences.effectiveRidingWindowMinutes,
            hoursAvailable: settings.hoursAvailable,
            backBy: backBy,
            intent: settings.intent,
            bike: settings.bike,
            // No known rider location -> the route's own start, which
            // zeroes the travel term instead of inventing one. (The
            // literal is unreachable in practice: a route with no start
            // never got a forecast, so it was skipped.)
            startLocationFor: { route in travelOrigin ?? route.start ?? Coordinate(latitude: 51.7520, longitude: -0.8010) },
            scorer: scorer(routes: routes)
        )
    }

    /// The 10-day best-day scan for one route: per-day forecasts at the
    /// route's start, each day anchored at its own best window, travel
    /// measured from the rider, same scorer as the day ranking. Days
    /// without forecast confidence are skipped.
    private func loadRecommendation(for rankedRide: RankedRide) async -> DayRecommendation? {
        let routes = routeModels.map { $0.asRoute() }
        guard let route = routes.first(where: { $0.id == rankedRide.route.id }),
              let routeStart = route.start else { return nil }
        let settings = preferencesStore.todaySettings
        let scorer = scorer(routes: routes)
        let contexts = await Recommendations.upcomingWindowContexts(
            route: route,
            weather: services.weather,
            weatherLocation: routeStart,
            startLocation: travelOrigin ?? routeStart,
            ridingWindowMinutes: preferencesStore.preferences.effectiveRidingWindowMinutes,
            hoursAvailable: settings.hoursAvailable,
            backBy: backBy,
            intent: settings.intent,
            bike: settings.bike,
            scorer: scorer
        )
        return Recommendations.bestDay(for: route, contexts: contexts, scorer: scorer)
    }

    private func breakdownItem(for rankedRide: RankedRide, hoursByRouteID: [UUID: [HourlyWeather]], windowStart: Date?) -> BreakdownItem {
        let weather = windowStart.flatMap { hoursByRouteID[rankedRide.route.id]?.snapshot(at: $0) }
        return BreakdownItem(
            rankedRide: rankedRide,
            chips: chips(for: rankedRide, weather: weather, windowStart: windowStart)
        )
    }

    private func chips(for rankedRide: RankedRide, weather: WeatherSnapshot?, windowStart: Date?) -> [ConditionChipData] {
        guard let weather else { return [] }
        // ponytail: a chip is a terse capsule, not a sentence — the factor's
        // `reason` (shown in full in the breakdown sheet's FactorRow) is too
        // long here, so this always builds the short "N km/h" form instead.
        return ConditionChipData.rideChips(
            windLabel: "\(UnitFormat.speed(kph: weather.windKph, system: unitSystem)) wind",
            temperatureC: weather.temperatureC,
            sky: weather.sky,
            travelMinutes: travelMinutesByRouteID[rankedRide.route.id],
            rideHours: preferencesStore.todaySettings.hoursAvailable,
            windowText: windowStart.flatMap(windowText)
        )
    }

    /// "10:00–13:00" for the shared best window — suppressed on Today when
    /// the window is effectively "ride now", where the plain duration chip
    /// says more.
    private func windowText(start: Date) -> String? {
        if selectedDayOffset == 0, start.timeIntervalSince(.now) < 45 * 60 { return nil }
        let end = start.addingTimeInterval(preferencesStore.todaySettings.hoursAvailable * 3600)
        return start.formatted(date: .omitted, time: .shortened) + "–" + end.formatted(date: .omitted, time: .shortened)
    }

    private func statsLine(for model: RouteModel) -> String {
        let time = RouteStats.estimatedRideTime(for: model, preferences: preferencesStore.preferences)
        return [
            UnitFormat.distance(km: model.distanceKm, system: unitSystem),
            UnitFormat.elevation(m: model.elevationGainM, system: unitSystem),
            "~" + Duration.seconds(time).formatted(.units(allowed: [.hours, .minutes], width: .narrow)),
        ].joined(separator: " · ")
    }

    // MARK: - Loading

    private func loadWeather() async {
        if case .loaded = weatherLoad {
            // keep showing stale content during a refresh or day switch; the
            // spinner is only for the first load of the day
        } else {
            weatherLoad = .loading
        }

        // Snapshot the starts before fanning out — SwiftData models aren't
        // Sendable, coordinates are.
        let starts: [(id: UUID, start: Coordinate)] = routeModels.compactMap { model in
            (model.coordinates.first ?? savedPlaces.first?.coordinate).map { (model.id, $0) }
        }
        guard !starts.isEmpty else {
            weatherLoad = .failed
            return
        }

        let weatherService = services.weather
        let selectedDay = day(at: selectedDayOffset)
        var byRouteID: [UUID: [HourlyWeather]] = [:]
        await withTaskGroup(of: (UUID, [HourlyWeather]?).self) { group in
            for (id, start) in starts {
                group.addTask {
                    (id, try? await weatherService.hourlyForecast(for: start, on: selectedDay))
                }
            }
            for await (id, hours) in group {
                if let hours { byRouteID[id] = hours }
            }
        }

        if byRouteID.isEmpty {
            // A failed *refresh* keeps the last data on screen — the Retry
            // state is only for having nothing at all to show.
            if case .loaded = weatherLoad { return }
            weatherLoad = .failed
        } else {
            weatherLoad = .loaded(byRouteID)
            loadedDay = .now
        }
    }

    /// Cycling ETA from the rider's location to each route's start — no
    /// origin (permission denied, no saved place) or regional MapKit failures
    /// just drop that chip rather than surfacing an error (DESIGN-SYSTEM.md
    /// §9: a missing travel chip is fine, an error banner isn't).
    private func loadTravelTimes(requestingPermission: Bool) async {
        deviceLocation = await services.location.currentLocation(requestingPermissionIfNeeded: requestingPermission)
        guard let origin = travelOrigin else { return }
        for route in routeModels {
            guard let destination = route.coordinates.first else { continue }
            if let seconds = try? await services.eta.travelTime(from: origin, to: destination, mode: .cycling) {
                travelMinutesByRouteID[route.id] = Int((seconds / 60).rounded())
            }
        }
    }
}

private struct BreakdownItem: Identifiable {
    var rankedRide: RankedRide
    var chips: [ConditionChipData]
    var id: UUID { rankedRide.route.id }
}

/// One ranked runner-up: map thumbnail, name, stats, this route's own sky +
/// temperature at the shared window, compact `ScoreRing`. Not a §6
/// component — screen-specific, like `ContextToolbarButton`.
private struct RankedRouteRow: View {
    var model: RouteModel
    var score: Double
    var stats: String
    var weather: WeatherSnapshot?
    var onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var thumbnail: PlatformImage?

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                thumbnailView

                VStack(alignment: .leading, spacing: 4) {
                    Text(model.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(stats)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if let weather {
                    HStack(spacing: 4) {
                        Image(systemName: weather.sky.systemImageName)
                            .foregroundStyle(ConditionPalette.color(forTemperatureC: weather.temperatureC))
                        Text(UnitFormat.temperature(c: weather.temperatureC))
                            .monospacedDigit()
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }

                ScoreRing(score: score, size: 36)
            }
            .padding(12)
            .background(.regularMaterial, in: .rect(cornerRadius: CornerRadius.card))
            .contentShape(.rect(cornerRadius: CornerRadius.card))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySentence)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("ride-route-row")
        .task(id: model.id) {
            thumbnail = await RouteSnapshotService.snapshot(
                routeID: model.id,
                coordinates: model.coordinates,
                size: CGSize(width: 200, height: 200),
                colorScheme: colorScheme
            )
        }
    }

    @ViewBuilder
    private var thumbnailView: some View {
        Group {
            if let thumbnail {
                Image(platformImage: thumbnail).resizable().scaledToFill()
            } else {
                Rectangle().fill(.secondary.opacity(0.15))
            }
        }
        .frame(width: 56, height: 56)
        .clipShape(.rect(cornerRadius: 12))
    }

    private var accessibilitySentence: String {
        var sentence = "\(model.name), \(stats). Score \(Int((score * 100).rounded())) out of 100."
        if let weather {
            sentence += " \(UnitFormat.temperature(c: weather.temperatureC))."
        }
        return sentence
    }
}

/// Not a §6 component — a screen-specific summary button, not a reusable
/// named component; the closed 8-component inventory covers reusable UI,
/// not every custom view. Lives in the navigation bar, so it rides the
/// system's toolbar glass — no custom `glassEffect` needed (DESIGN-SYSTEM.md
/// §2: glass is chrome). The visible label is deliberately just the two
/// highest-value facts (hours · bike); intent and back-by stay in the
/// editor sheet and the accessibility label.
private struct ContextToolbarButton: View {
    var bike: Bike
    var hoursAvailable: Double
    var intent: RideIntent
    var backBy: Date?
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "bicycle")
                Text("\(hoursText) · \(bike.name)")
                    .font(.subheadline.weight(.medium))
                    .monospacedDigit()
            }
        }
        .accessibilityLabel("Ride context: \(fullSummary). Double tap to edit.")
        .accessibilityIdentifier("ride-context-button")
    }

    private var fullSummary: String {
        var parts = ["\(bike.name)", hoursText, intent.rawValue.capitalized]
        if let backBy {
            parts.append("back by \(backBy.formatted(date: .omitted, time: .shortened))")
        }
        return parts.joined(separator: " · ")
    }

    private var hoursText: String {
        hoursAvailable < 1 ? "\(Int(hoursAvailable * 60))m" : "\(hoursAvailable.formatted(.number.precision(.fractionLength(0...1))))h"
    }
}

private struct ContextEditorSheet: View {
    @Binding var hoursAvailable: Double
    @Binding var intent: RideIntent
    @Binding var bike: Bike
    @Binding var backBy: Date?
    @Environment(\.dismiss) private var dismiss
    @State private var hasBackBy: Bool

    init(hoursAvailable: Binding<Double>, intent: Binding<RideIntent>, bike: Binding<Bike>, backBy: Binding<Date?>) {
        _hoursAvailable = hoursAvailable
        _intent = intent
        _bike = bike
        _backBy = backBy
        _hasBackBy = State(initialValue: backBy.wrappedValue != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Bike") {
                    Picker("Bike", selection: $bike) {
                        ForEach(Bike.samples) { sample in
                            Text(sample.name).tag(sample)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Section("Time") {
                    LabeledContent("Hours available") {
                        Text("\(hoursAvailable.formatted(.number.precision(.fractionLength(0...1)))) hr")
                            .monospacedDigit()
                            .contentTransition(.numericText(value: hoursAvailable))
                    }
                    Slider(value: $hoursAvailable, in: 0.5...8, step: 0.5) {
                        Text("Hours available")
                    }
                    .labelsHidden()
                }
                Section("Intent") {
                    Picker("Intent", selection: $intent) {
                        ForEach(RideIntent.allCases, id: \.self) { value in
                            Text(value.rawValue.capitalized).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Section("Back By") {
                    Toggle("Set a return time", isOn: $hasBackBy)
                    if hasBackBy {
                        DatePicker("Back by", selection: Binding(
                            get: { backBy ?? .now },
                            set: { backBy = $0 }
                        ), displayedComponents: .hourAndMinute)
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Ride Plan")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.defaultAction)
                }
            }
            .onChange(of: hasBackBy) { _, newValue in
                if !newValue { backBy = nil }
            }
        }
        .presentationDetents([.medium])
    }
}

/// The breakdown sheet, titled with the route's name: `ScoreRing` tier
/// header with the 10-day best-day verdict directly beneath it (loaded
/// async — recommended day + tier reasoning as plain text, no card; tapping
/// a ride day jumps the day selector there), this route's condition chips,
/// one clean `FactorRow` explainer per factor, a View Route push, weather
/// attribution footer. System glass at partial detents (free) on iOS; a
/// standard modal with a Done button on macOS.
private struct BreakdownSheet: View {
    var rankedRide: RankedRide
    var chips: [ConditionChipData]
    var loadRecommendation: () async -> DayRecommendation?
    var onViewRoute: (UUID) -> Void
    var onSelectDay: (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .title) private var ringSize: CGFloat = 64
    @State private var recommendation: DayRecommendation?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 8) {
                        ScoreRing(score: rankedRide.score, size: ringSize)
                        if let recommendation {
                            bestDayLine(recommendation)
                        }
                    }
                    ConditionChipRow(chips: chips)
                    VStack(spacing: 12) {
                        ForEach(rankedRide.factorScores, id: \.factor) { score in
                            FactorRow(score: score)
                        }
                    }
                    Button {
                        onViewRoute(rankedRide.route.id)
                    } label: {
                        Label("View Route", systemImage: "map")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    WeatherAttributionFooter()
                }
                .padding()
            }
            .navigationTitle(rankedRide.route.name)
            .navigationBarTitleDisplayModeIfAvailable()
            .task {
                let loaded = await loadRecommendation()
                withAnimation(Motion.panelMaterialize) { recommendation = loaded }
            }
            #if os(macOS)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.defaultAction)
                }
            }
            #endif
        }
        .presentationDetents([.medium, .large])
    }

    /// The best-day verdict as plain text under the score ring — day +
    /// tier reasoning ("Best day: Tomorrow / Great conditions"), or the
    /// explicit skip. A ride day is a button that jumps the day selector.
    @ViewBuilder
    private func bestDayLine(_ recommendation: DayRecommendation) -> some View {
        if recommendation.tier.isWorthRiding {
            Button {
                onSelectDay(recommendation.context.date)
            } label: {
                verdictText(
                    headline: "Best day: \(dayName(recommendation.context.date))",
                    reason: recommendation.tier.summary
                )
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows that day's ranking")
        } else {
            verdictText(headline: "Give it a miss", reason: "No day worth riding in the next 10 days")
        }
    }

    private func verdictText(headline: String, reason: String) -> some View {
        VStack(spacing: 2) {
            Text(headline)
                .font(.subheadline.weight(.semibold))
            Text(reason)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("best-day-line")
    }

    private func dayName(_ date: Date) -> String {
        let calendar = Calendar.current
        return calendar.isDateInToday(date) ? "Today"
            : calendar.isDateInTomorrow(date) ? "Tomorrow"
            : date.formatted(.dateTime.weekday(.wide))
    }
}

private extension View {
    @ViewBuilder
    func navigationBarTitleDisplayModeIfAvailable() -> some View {
        #if os(iOS)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
}

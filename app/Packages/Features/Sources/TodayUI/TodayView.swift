import SwiftUI
import SwiftData
import Models
import Engine
import Services
import DesignSystem
import Router
import SharedUI

/// DESIGN-SYSTEM.md §9 "Today": a hero `RideCard` for the top-ranked route
/// with every other route in a ranked list below, a context pill for the
/// day's bike/hours/intent/back-by inputs, and a tap-to-open breakdown
/// sheet. Weather is fetched per route start (the day cache dedupes nearby
/// starts), so each route is scored against its own forecast.
public struct TodayView: View {
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
        case loaded([UUID: WeatherSnapshot])
    }

    @State private var weatherLoad: WeatherLoad = .loading
    @State private var loadedDay: Date?
    @State private var backBy: Date?
    @State private var deviceLocation: Coordinate?
    @State private var isContextEditorPresented = false
    @State private var breakdownItem: BreakdownItem?
    @State private var isLocationPrimingPresented = false
    @State private var travelMinutesByRouteID: [UUID: Int] = [:]
    @ScaledMetric(relativeTo: .largeTitle) private var restDaySymbolSize: CGFloat = 40

    // A route only takes the hero slot when today's conditions grade as
    // worth riding (tier C or better) — otherwise the "rest day" card takes
    // it, with the ranked list still below.

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
                case .loaded(let weatherByRouteID):
                    rankedContent(weatherByRouteID: weatherByRouteID)
                }
            }
        }
        .navigationTitle("Today")
        .task(id: routeModels.map(\.id)) {
            await loadWeather()
        }
        .task(id: preferencesStore.hasPrimedLocationPermission) {
            // DESIGN-SYSTEM.md §9: location is primed on first Today entry.
            // Until primed, don't touch CoreLocation — the system prompt may
            // only ever follow the priming sheet's Allow.
            guard preferencesStore.hasPrimedLocationPermission else {
                isLocationPrimingPresented = true
                return
            }
            await loadTravelTimes(requestingPermission: false)
        }
        .onChange(of: scenePhase) { _, phase in
            // Day rollover while backgrounded: yesterday's ranking is stale.
            if phase == .active, let loadedDay, !Calendar.current.isDate(loadedDay, inSameDayAs: .now) {
                Task { await loadWeather() }
            }
        }
        // Landmarks idiom: floating chrome goes in the safe-area bar, not an
        // overlay — content automatically lays out above it.
        .safeAreaBar(edge: .bottom) {
            if case .loaded = weatherLoad, !routeModels.isEmpty {
                contextPill
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

    // MARK: - Ranked content

    private func rankedContent(weatherByRouteID: [UUID: WeatherSnapshot]) -> some View {
        let ranked = rankedRides(weatherByRouteID: weatherByRouteID)
        let heroRide = ranked.first.flatMap { $0.tier.isWorthRiding ? $0 : nil }

        return ScrollView {
            VStack(spacing: 16) {
                if let heroRide {
                    hero(for: heroRide, weatherByRouteID: weatherByRouteID)
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
                            weather: weatherByRouteID[model.id]
                        ) {
                            breakdownItem = breakdownItem(for: rankedRide, weatherByRouteID: weatherByRouteID)
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
    private func hero(for rankedRide: RankedRide, weatherByRouteID: [UUID: WeatherSnapshot]) -> some View {
        if let model = routeModels.first(where: { $0.id == rankedRide.route.id }) {
            RideCard(
                routeID: model.id,
                routeName: model.name,
                coordinates: model.coordinates,
                chips: chips(for: rankedRide, weather: weatherByRouteID[model.id]),
                sky: weatherByRouteID[model.id]?.sky ?? .sunny,
                score: rankedRide.score,
                stats: statsLine(for: model)
            )
            .frame(height: 420)
            .onTapGesture {
                breakdownItem = breakdownItem(for: rankedRide, weatherByRouteID: weatherByRouteID)
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
            Text("Nothing in your routes fits today's conditions and time budget well. Adjust your plans or check back tomorrow.")
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
            Text("Recommendations need today's forecast. Check your connection and try again.")
        } actions: {
            Button("Retry") {
                Task { await loadWeather() }
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var contextPill: some View {
        // Landmarks wraps all custom glass in a `GlassEffectContainer` so
        // multiple glass elements on one screen merge/morph correctly.
        GlassEffectContainer {
            ContextPillButton(
                bike: preferencesStore.todaySettings.bike,
                hoursAvailable: preferencesStore.todaySettings.hoursAvailable,
                intent: preferencesStore.todaySettings.intent,
                backBy: backBy
            ) {
                isContextEditorPresented = true
            }
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

    /// Each route is ranked in its own context: same rider inputs and start
    /// location (travel distance must stay rider -> route start), but that
    /// route's own forecast. Routes whose forecast fetch failed are skipped
    /// rather than ranked against someone else's weather.
    private func rankedRides(weatherByRouteID: [UUID: WeatherSnapshot]) -> [RankedRide] {
        let routes = routeModels.map { $0.asRoute() }
        let settings = preferencesStore.todaySettings
        let scorer = Recommendations.scorer(
            preferences: preferencesStore.preferences,
            rideLogs: rideLogs,
            allRoutes: routes,
            weights: preferencesStore.weights
        )

        let ranked = routes.compactMap { route -> RankedRide? in
            guard let weather = weatherByRouteID[route.id] else { return nil }
            let context = Recommendations.context(
                date: .now,
                // No known rider location -> the route's own start, which
                // zeroes the travel term instead of inventing one. (The
                // literal is unreachable in practice: a route with no start
                // never got a forecast, so it was skipped above.)
                startLocation: travelOrigin ?? route.start ?? Coordinate(latitude: 51.7520, longitude: -0.8010),
                hoursAvailable: settings.hoursAvailable,
                backBy: backBy,
                intent: settings.intent,
                bike: settings.bike,
                weather: weather
            )
            return scorer.rank(routes: [route], context: context).first
        }

        return ranked.sorted { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            return lhs.route.id.uuidString < rhs.route.id.uuidString
        }
    }

    /// The 10-day best-day scan for one route: per-day forecasts at the
    /// route's start, travel measured from the rider, same scorer as the
    /// today ranking. Days without forecast confidence are skipped.
    private func loadRecommendation(for rankedRide: RankedRide) async -> DayRecommendation? {
        let routes = routeModels.map { $0.asRoute() }
        guard let route = routes.first(where: { $0.id == rankedRide.route.id }),
              let routeStart = route.start else { return nil }
        let settings = preferencesStore.todaySettings
        let contexts = await Recommendations.upcomingContexts(
            weather: services.weather,
            weatherLocation: routeStart,
            startLocation: travelOrigin ?? routeStart,
            hoursAvailable: settings.hoursAvailable,
            backBy: backBy,
            intent: settings.intent,
            bike: settings.bike
        )
        let scorer = Recommendations.scorer(
            preferences: preferencesStore.preferences,
            rideLogs: rideLogs,
            allRoutes: routes,
            weights: preferencesStore.weights
        )
        return Recommendations.bestDay(for: route, contexts: contexts, scorer: scorer)
    }

    private func breakdownItem(for rankedRide: RankedRide, weatherByRouteID: [UUID: WeatherSnapshot]) -> BreakdownItem {
        BreakdownItem(
            rankedRide: rankedRide,
            chips: chips(for: rankedRide, weather: weatherByRouteID[rankedRide.route.id])
        )
    }

    private func chips(for rankedRide: RankedRide, weather: WeatherSnapshot?) -> [ConditionChipData] {
        guard let weather else { return [] }
        // ponytail: a chip is a terse capsule, not a sentence — the factor's
        // `reason` (shown in full in the breakdown sheet's FactorRow) is too
        // long here, so this always builds the short "N km/h" form instead.
        return ConditionChipData.todayChips(
            windLabel: "\(UnitFormat.speed(kph: weather.windKph, system: unitSystem)) wind",
            temperatureC: weather.temperatureC,
            sky: weather.sky,
            travelMinutes: travelMinutesByRouteID[rankedRide.route.id],
            rideHours: preferencesStore.todaySettings.hoursAvailable
        )
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
            // keep showing stale content during a refresh; the spinner is
            // only for the first load of the day
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
        var byRouteID: [UUID: WeatherSnapshot] = [:]
        await withTaskGroup(of: (UUID, WeatherSnapshot?).self) { group in
            for (id, start) in starts {
                group.addTask {
                    (id, try? await weatherService.forecast(for: start, on: .now))
                }
            }
            for await (id, snapshot) in group {
                if let snapshot { byRouteID[id] = snapshot }
            }
        }

        if byRouteID.isEmpty {
            // A failed *refresh* keeps yesterday's data on screen — the
            // Retry state is only for having nothing at all to show.
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
/// temperature, compact `ScoreRing`. Not a §6 component — screen-specific,
/// like `ContextPillButton`.
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
        .accessibilityIdentifier("today-route-row")
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
/// not every custom view. The one sanctioned custom-glass use per
/// DESIGN-SYSTEM.md §2, with the required Reduce Transparency fallback.
private struct ContextPillButton: View {
    var bike: Bike
    var hoursAvailable: Double
    var intent: RideIntent
    var backBy: Date?
    var action: () -> Void

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Group {
            if reduceTransparency {
                // DESIGN-SYSTEM.md §2: custom glass must fall back to an
                // opaque `Material` when Reduce Transparency is on.
                label.background(.regularMaterial, in: .capsule)
            } else {
                label.glassEffect(.regular.interactive(), in: .capsule)
            }
        }
        .accessibilityLabel("Ride context: \(summary). Double tap to edit.")
    }

    private var label: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "bicycle")
                Text(summary)
                    .font(.subheadline.weight(.medium))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    private var summary: String {
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
                }
                Section("Time") {
                    Slider(value: $hoursAvailable, in: 0.5...8, step: 0.5) {
                        Text("Hours available")
                    }
                    Text("\(hoursAvailable.formatted(.number.precision(.fractionLength(0...1)))) hours")
                        .foregroundStyle(.secondary)
                }
                Section("Intent") {
                    Picker("Intent", selection: $intent) {
                        ForEach(RideIntent.allCases, id: \.self) { value in
                            Text(value.rawValue.capitalized).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
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
            .navigationTitle("Today's Ride")
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

/// The breakdown sheet: `ScoreRing` tier header, this route's condition
/// chips, the 10-day `BestDayBadge` verdict (loaded async — ride day + tier,
/// or an explicit "give it a miss"), one clean `FactorRow` explainer per
/// factor, a View Route push, weather attribution footer. System glass at
/// partial detents (free) on iOS; a standard modal with a Done button on
/// macOS.
private struct BreakdownSheet: View {
    var rankedRide: RankedRide
    var chips: [ConditionChipData]
    var loadRecommendation: () async -> DayRecommendation?
    var onViewRoute: (UUID) -> Void

    @Environment(\.dismiss) private var dismiss
    @ScaledMetric(relativeTo: .title) private var ringSize: CGFloat = 64
    @State private var recommendation: DayRecommendation?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ScoreRing(score: rankedRide.score, size: ringSize)
                    Text(rankedRide.route.name)
                        .font(.headline)
                    ConditionChipRow(chips: chips)
                    if let recommendation {
                        BestDayBadge(recommendation: recommendation)
                    }
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
            .navigationTitle("Why This Ride")
            .navigationBarTitleDisplayModeIfAvailable()
            .task { recommendation = await loadRecommendation() }
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

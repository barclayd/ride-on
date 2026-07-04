import SwiftUI
import SwiftData
import Models
import Engine
import Services
import DesignSystem
import Router
import SharedUI

/// DESIGN-SYSTEM.md §9 "Today card stack": a `TabView(.page)` of `RideCard`s
/// ranked by `Recommendations.scorer`, a context pill for the day's
/// bike/hours/intent/back-by inputs, and a swipe-up breakdown sheet.
public struct TodayView: View {
    public var namespace: Namespace.ID

    @Environment(\.services) private var services
    @Environment(PreferencesStore.self) private var preferencesStore
    @Query(sort: \RouteModel.createdAt) private var routeModels: [RouteModel]
    @Query private var savedPlaces: [SavedPlaceModel]
    @Query private var rideLogModels: [RideLogModel]

    @State private var hoursAvailable: Double = 3
    @State private var intent: RideIntent = .exploring
    @State private var bike: Bike = Bike.samples[0]
    @State private var backBy: Date?
    @State private var weather: WeatherSnapshot?
    @State private var isContextEditorPresented = false
    @State private var breakdownItem: BreakdownItem?

    // ponytail: below this, a route isn't worth surfacing as a
    // recommendation — the "rest day" card takes over instead of a stack of
    // routes nobody wants. Tune once real-world scores are observed.
    private static let restDayThreshold = 0.35

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
            } else if weather == nil {
                ProgressView()
            } else if rankedRides.isEmpty || (rankedRides.first?.score ?? 0) < Self.restDayThreshold {
                restDayCard
            } else {
                cardStack
            }
        }
        .navigationTitle("Today")
        .task {
            weather = try? await services.weather.forecast(for: startLocation, on: .now)
        }
        .overlay(alignment: .bottom) {
            if weather != nil, !routeModels.isEmpty {
                contextPill
                    .padding(.bottom, 12)
            }
        }
        .sheet(isPresented: $isContextEditorPresented) {
            ContextEditorSheet(hoursAvailable: $hoursAvailable, intent: $intent, bike: $bike, backBy: $backBy)
        }
        .sheet(item: $breakdownItem) { item in
            BreakdownSheet(rankedRide: item.rankedRide)
        }
    }

    private var cardStack: some View {
        TabView {
            ForEach(rankedRides, id: \.route.id) { rankedRide in
                if let model = routeModels.first(where: { $0.id == rankedRide.route.id }) {
                    NavigationLink(value: RouterDestination.routeDetail(routeID: model.id)) {
                        RideCard(
                            routeID: model.id,
                            routeName: model.name,
                            coordinates: model.coordinates,
                            chips: chips(for: rankedRide),
                            sky: weather.map(\.sky) ?? .sunny,
                            onSwipeUpForDetails: { breakdownItem = BreakdownItem(rankedRide: rankedRide) }
                        )
                    }
                    .buttonStyle(.plain)
                    .matchedTransitionSource(id: model.id, in: namespace)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 40)
                }
            }
        }
        .pagedTabViewStyleIfAvailable()
    }

    private var restDayCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "leaf")
                .font(.system(size: 40))
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial, in: .rect(cornerRadius: 24))
        .padding()
    }

    private var contextPill: some View {
        ContextPillButton(bike: bike, hoursAvailable: hoursAvailable, intent: intent, backBy: backBy) {
            isContextEditorPresented = true
        }
    }

    private var startLocation: Coordinate {
        savedPlaces.first?.coordinate ?? Coordinate(latitude: 51.7520, longitude: -0.8010)
    }

    private var rideLogs: [RideLog] {
        rideLogModels.compactMap { $0.asRideLog() }
    }

    private var rankedRides: [RankedRide] {
        guard let weather else { return [] }
        let routes = routeModels.map { $0.asRoute() }
        let scorer = Recommendations.scorer(
            preferences: preferencesStore.preferences,
            rideLogs: rideLogs,
            allRoutes: routes,
            weights: preferencesStore.weights
        )
        let context = Recommendations.context(
            date: .now,
            startLocation: startLocation,
            hoursAvailable: hoursAvailable,
            backBy: backBy,
            intent: intent,
            bike: bike,
            weather: weather
        )
        return scorer.rank(routes: routes, context: context)
    }

    private func chips(for rankedRide: RankedRide) -> [ConditionChipData] {
        guard let weather else { return [] }
        // ponytail: a chip is a terse capsule, not a sentence — the factor's
        // `reason` (shown in full in the breakdown sheet's FactorRow) is too
        // long here, so this always builds the short "N km/h" form instead.
        return ConditionChipData.todayChips(
            windLabel: "\(Int(weather.windKph.rounded())) km/h wind",
            temperatureC: weather.temperatureC,
            sky: weather.sky,
            travelMinutes: nil,
            rideHours: hoursAvailable
        )
    }
}

private struct BreakdownItem: Identifiable {
    var rankedRide: RankedRide
    var id: UUID { rankedRide.route.id }
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
                }
            }
            .onChange(of: hasBackBy) { _, newValue in
                if !newValue { backBy = nil }
            }
        }
        .presentationDetents([.medium])
    }
}

/// The breakdown sheet: `ScoreRing` header, `FactorRow` per factor,
/// weather attribution footer. System glass at partial detents (free).
private struct BreakdownSheet: View {
    var rankedRide: RankedRide

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ScoreRing(score: rankedRide.score, size: 64)
                    VStack(spacing: 12) {
                        ForEach(rankedRide.factorScores, id: \.factor) { score in
                            FactorRow(score: score)
                        }
                    }
                    WeatherAttributionFooter()
                }
                .padding()
            }
            .navigationTitle("Why This Ride")
            .navigationBarTitleDisplayModeIfAvailable()
        }
        .presentationDetents([.fraction(0.35), .medium, .large])
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

    // ponytail: `.page` `TabViewStyle` is iOS-only — Mac's card stack is a
    // plain (non-paged) `TabView`, still swipeable/scrollable via trackpad.
    @ViewBuilder
    func pagedTabViewStyleIfAvailable() -> some View {
        #if os(iOS)
        self.tabViewStyle(.page)
        #else
        self
        #endif
    }
}

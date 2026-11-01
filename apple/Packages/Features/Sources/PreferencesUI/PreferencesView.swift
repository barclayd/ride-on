import PlatformServices
import Persistence
import SwiftUI
import Domain
import Services
import SharedUI
import DesignSystem

/// The Preferences tab (docs/redesign/README.md §5): plain settings rows for the plumbing, a
/// visual screen for taste. Every change saves itself and re-ranks Rides.
public struct PreferencesView: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(PreferencesStore.self) private var local
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.locale) private var locale
    @State private var isHealthPrimingPresented = false
    /// The screen someone opened: beside Preferences when they're side by side, pushed otherwise.
    @State private var opened: PreferencesPage?
    /// `opened` while Preferences has the screen to itself.
    @State private var pushed: PreferencesPage?
    @Environment(\.paneShape) private var paneShape

    public init() {}

    /// Preferences and a screen it opens side by side: the open phone in landscape.
    private var isSplit: Bool { paneShape == .wide }

    /// The screen beside Preferences: the one opened, or Ideal Temperature until one is.
    private var shown: PreferencesPage? {
        if let opened, isAvailable(opened) { return opened }
        if store.settings != nil { return .temperature }
        return store.phase == .loading ? nil : .about
    }

    /// The screen beside Preferences, marked where Preferences lists it.
    private var selected: PreferencesPage? { isSplit ? shown : nil }

    public var body: some View {
        layout
            .navigationTitle("Preferences")
            .navigationSubtitle("Changes re-rank your rides straight away.")
            // Side by side, each pane has its own title, and the rail keeps no title.
            .toolbar(removing: isSplit ? .title : nil)
            .navigationDestination(item: $pushed) { page in
                content(page)
            }
            // Opening or closing the phone moves the open screen between the pane and the stack,
            // without a push or a pop: it was already on screen.
            .onChange(of: isSplit) { _, split in
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    pushed = split ? nil : opened
                }
            }
            // Back from the pushed screen closes it, so opening the phone shows Ideal Temperature.
            .onChange(of: pushed) { _, page in
                if page == nil && !isSplit { opened = nil }
            }
            .task { await store.load() }
            .sheet(isPresented: $isHealthPrimingPresented) {
                PermissionPrimingSheet(
                    symbol: "heart.fill",
                    title: "Match Your Rides",
                    message: "Ride On reads your cycling workouts from Health to automatically log rides against your routes.",
                    onAllow: {
                        local.hasPrimedHealthPermission = true
                        local.isRideMatchingEnabled = true
                        #if os(iOS)
                        Task { try? await HealthAuthorization.requestCyclingAuthorization() }
                        #endif
                    },
                    onNotNow: { local.hasPrimedHealthPermission = true }
                )
            }
    }

    /// One structure in every shape, so the list keeps its scroll as the phone opens and closes.
    /// Open in landscape, Preferences takes the leading half, up to the fold, and the screen it
    /// opened the trailing half.
    private var layout: some View {
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            let full = proxy.size.width + insets.leading + insets.trailing
            let listWidth = isSplit ? (full / 2).rounded(.down) - insets.leading : proxy.size.width
            HStack(spacing: 0) {
                list
                    .safeAreaBar(edge: .top) {
                        if isSplit { PaneBar("Preferences") {} }
                    }
                    .frame(width: listWidth)
                if isSplit, let shown {
                    content(shown)
                        .id(shown)
                        .safeAreaBar(edge: .top) { PaneBar(shown.title) {} }
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(.separator)
                                .frame(width: 0.5)
                                .ignoresSafeArea()
                        }
                }
            }
        }
    }

    private var list: some View {
        Form {
            if store.settings != nil {
                goodRide
                dealBreakers
                riding
            } else {
                status
            }
            UnitsSection()
            connections
            account
        }
        .formStyle(.grouped)
    }

    /// Opens a screen: beside Preferences when there's room, pushed otherwise.
    private func open(_ page: PreferencesPage) {
        opened = page
        if !isSplit { pushed = page }
    }

    private func isAvailable(_ page: PreferencesPage) -> Bool {
        switch page {
        case .temperature, .wind, .distance: store.settings != nil
        case .account: store.phase == .loaded
        case .strava, .about, .maps: true
        }
    }

    @ViewBuilder private func content(_ page: PreferencesPage) -> some View {
        switch page {
        case .temperature: IdealTemperatureView()
        case .wind: ComfortableWindView()
        case .distance: DistanceView()
        case .strava: StravaConnectionView(live: !FixtureWorld.isEnabled)
        case .account: AccountView()
        case .about: AboutView()
        case .maps:
            #if os(iOS)
            MapCreditsView()
            #else
            EmptyView()
            #endif
        }
    }

    /// A row that opens `page`, with its label. Only a page's own row shows it's open in the
    /// split, not the deal-breakers that open it too.
    private func link(_ page: PreferencesPage, marksOpen: Bool = true,
                      @ViewBuilder label: () -> some View) -> some View {
        PageLink(page: page, selected: marksOpen ? selected : nil, open: open, label: label(), destination: content(page))
    }

    private var settings: Binding<RiderSettings> { store.binding }
    private var preferences: RiderSettings.Preferences { settings.wrappedValue.preferences }

    // MARK: Sections

    private var goodRide: some View {
        Section {
            link(.temperature) {
                LabeledContent {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(UnitFormat.temperatureRange(c: preferences.temperature.comfortMinC...preferences.temperature.comfortMaxC, locale: locale))
                        TemperatureRange.Bar(preferences.temperature.comfortMinC...preferences.temperature.comfortMaxC)
                            .frame(width: 80, height: 4)
                    }
                } label: {
                    Row("Ideal Temperature", "thermometer.medium", .orange)
                }
            }
            link(.wind) {
                LabeledContent {
                    Text("Up to \(UnitFormat.speed(kph: preferences.wind.comfortableHeadwindKph, system: speedSystem, locale: locale))")
                } label: {
                    Row("Comfortable Wind", "wind", .cyan)
                }
            }
            Picker(selection: settings.sunshine) {
                Text("Don't Mind").tag(RiderSettings.SunshineLevel.dontMind)
                Text("Nice to Have").tag(RiderSettings.SunshineLevel.nice)
                Text("Important").tag(RiderSettings.SunshineLevel.important)
                if settings.wrappedValue.sunshine == .custom { Text("Custom").tag(RiderSettings.SunshineLevel.custom) }
            } label: {
                Row("Sunshine", "sun.max.fill", .yellow)
            }
            Picker(selection: settings.rain) {
                Text("Don't Mind").tag(RiderSettings.RainLevel.dontMind)
                Text("Light Rain Is OK").tag(RiderSettings.RainLevel.lightOK)
                Text("Avoid Rain").tag(RiderSettings.RainLevel.avoid)
                if settings.wrappedValue.rain == .custom { Text("Custom").tag(RiderSettings.RainLevel.custom) }
            } label: {
                Row("Rain", "drop.fill", .blue)
            }
            Picker(selection: settings.preferences.climbing.preference) {
                Text("Flatter").tag(RiderSettings.Preferences.Climbing.Preference.flatter)
                Text("No Preference").tag(RiderSettings.Preferences.Climbing.Preference.neutral)
                Text("Hillier").tag(RiderSettings.Preferences.Climbing.Preference.hillier)
            } label: {
                Row("Climbing", "mountain.2.fill", .green)
            }
            link(.distance) {
                LabeledContent {
                    Text(preferences.distance.map { distanceRange($0.minKm...$0.maxKm) } ?? "Any")
                } label: {
                    Row("Distance", "point.topleft.down.to.point.bottomright.curvepath", .purple)
                }
            }
            Picker(selection: settings.preferences.recentRides.mode) {
                Text("No Preference").tag(RiderSettings.Preferences.RecentRides.Mode.neutral)
                Text("Prefer Variety").tag(RiderSettings.Preferences.RecentRides.Mode.preferVariety)
            } label: {
                Row("Recently Ridden", "arrow.triangle.2.circlepath", .teal)
            }
        } header: {
            Text("What Makes a Good Ride")
        } footer: {
            if preferences.recentRides.mode == .preferVariety {
                Text("Routes you rode in the last \(preferences.recentRides.lookbackDays) days score a little lower, so you see more of your list.")
            }
        }
        .tint(.secondary) // Menu values in grey, as in Settings.
    }

    private var dealBreakers: some View {
        Section {
            link(.temperature, marksOpen: false) {
                LabeledContent {
                    Text(preferences.minimumStandards.minimumTemperature.map { floor in
                        floor.isMonthly ? "By Month" : floor.valueC.map { UnitFormat.degrees(c: $0, locale: locale) } ?? "None"
                    } ?? "None")
                } label: {
                    Row("Never Colder Than", "snowflake", .indigo)
                }
            }
            link(.temperature, marksOpen: false) {
                LabeledContent {
                    Text(preferences.minimumStandards.maximumTemperatureC.map { UnitFormat.degrees(c: $0, locale: locale) } ?? "None")
                } label: {
                    Row("Never Hotter Than", "thermometer.high", .red)
                }
            }
            link(.wind, marksOpen: false) {
                LabeledContent {
                    Text(preferences.minimumStandards.maximumGustKph.map { UnitFormat.speed(kph: $0, system: speedSystem, locale: locale) } ?? "None")
                } label: {
                    Row("Gust Limit", "wind", Color(red: 0.4, green: 0.47, blue: 0.58))
                }
            }
            Picker(selection: settings.preferences.minimumStandards.maximumPrecipitationProbability) {
                Text("Any").tag(Double?.none)
                ForEach(choices([0.2, 0.4, 0.6, 0.8], keeping: preferences.minimumStandards.maximumPrecipitationProbability), id: \.self) { p in
                    Text(p.formatted(.percent.precision(.fractionLength(0)))).tag(Double?.some(p))
                }
            } label: {
                Row("Chance of Rain", "cloud.rain.fill", .blue)
            }
        } header: {
            Text("Deal-Breakers")
        } footer: {
            Text("Rides that break one of these still appear, marked Below your minimums, so you can decide.")
        }
        .tint(.secondary)
    }

    private var riding: some View {
        Section {
            Stepper {
                LabeledContent {
                    Text(UnitFormat.speed(kph: settings.wrappedValue.riding.averageSpeedKph, system: speedSystem, locale: locale))
                } label: {
                    Row("Average Speed", "gauge.with.dots.needle.33percent", .green)
                }
            } onIncrement: {
                stepSpeed(by: 1)
            } onDecrement: {
                stepSpeed(by: -1)
            }
            .sensoryFeedback(.selection, trigger: settings.wrappedValue.riding.averageSpeedKph)
            if let average = store.strava?.averageSpeedKph, abs(average - settings.wrappedValue.riding.averageSpeedKph) > 0.05 {
                Button {
                    settings.wrappedValue.riding.averageSpeedKph = average
                } label: {
                    Label {
                        Text("Use My Strava Average, \(UnitFormat.speed(kph: average, system: speedSystem, fractionDigits: 1, locale: locale))")
                    } icon: {
                        Color.clear.frame(width: Tile.size, height: Tile.size)
                    }
                }
            }
            Picker(selection: settings.riding.departureStepMinutes) {
                ForEach(choices([15, 30, 60], keeping: settings.wrappedValue.riding.departureStepMinutes), id: \.self) { minutes in
                    Text("\(minutes) min").tag(minutes)
                }
            } label: {
                Row("Try Departures Every", "clock", .gray)
            }
            .tint(.secondary)
        } header: {
            Text("Riding")
        } footer: {
            Text("Speed sets how long each route takes, and so whether it fits your window.")
        }
    }

    private var connections: some View {
        Section("Connections") {
            link(.strava) {
                Row("Strava", "figure.outdoor.cycle", .orange, subtitle: "Connection and completed rides")
            }
            #if os(iOS)
            Toggle(isOn: rideMatching) {
                Row("Apple Health", "heart.fill", .white, symbolColor: .red, subtitle: "Log rides from cycling workouts")
            }
            #endif
        }
    }

    private var account: some View {
        Section {
            if store.phase == .loaded {
                link(.account) {
                    LabeledContent {
                        Text("Signed In")
                    } label: {
                        // Linked methods, not how this session signed in, so "Signed In" stays neutral.
                        if store.providers.contains("apple") {
                            Row("Apple Account", "apple.logo", .black)
                        } else {
                            Row("Account", "person.fill", .black)
                        }
                    }
                }
            }
            link(.about) {
                Row("About Ride On", "info.circle", .gray)
            }
            #if os(iOS)
            link(.maps) {
                Row("Maps", "map.fill", .green, subtitle: "Map data and credits")
            }
            #endif
        } header: {
            Text("Account")
        } footer: {
            WeatherAttributionFooter(store.board?.credits ?? [])
        }
    }

    @ViewBuilder private var status: some View {
        Section {
            switch store.phase {
            case .loading, .loaded:
                ProgressView().frame(maxWidth: .infinity)
            case .signedOut:
                Text("Sign in on the Rides tab to see your preferences.")
                    .foregroundStyle(.secondary)
            case .failed(let message):
                Text(message).foregroundStyle(.secondary)
                Button("Try Again") { Task { await store.load() } }
            }
        }
    }

    // MARK: Helpers

    /// One step in the rider's units: 1 km/h, or 1 mph snapped to whole mph.
    private func stepSpeed(by delta: Double) {
        let unit = speedSystem == .metric ? 1 : 1.609344
        let kph = ((settings.wrappedValue.riding.averageSpeedKph / unit).rounded() + delta) * unit
        settings.wrappedValue.riding.averageSpeedKph = min(max(kph, 5), 50)
    }

    private func distanceRange(_ km: ClosedRange<Double>) -> String {
        let upper = UnitFormat.distance(km: km.upperBound, system: unitSystem, fractionDigits: 0, locale: locale)
        let lower = (unitSystem == .metric ? km.lowerBound : km.lowerBound / 1.609344).formatted(.number.precision(.fractionLength(0)).locale(locale))
        return "\(lower)–\(upper)"
    }

    // DESIGN-SYSTEM.md §9: Health is primed right before ride matching is turned on.
    private var rideMatching: Binding<Bool> {
        Binding(
            get: { local.isRideMatchingEnabled },
            set: { isOn in
                if isOn, !local.hasPrimedHealthPermission {
                    isHealthPrimingPresented = true
                } else {
                    local.isRideMatchingEnabled = isOn
                }
            }
        )
    }
}

/// A screen Preferences opens: pushed over it, or beside it on the open iPhone Duo.
enum PreferencesPage: Hashable {
    case temperature, wind, distance, strava, account, about, maps

    var title: String {
        switch self {
        case .temperature: "Ideal Temperature"
        case .wind: "Comfortable Wind"
        case .distance: "Distance"
        case .strava: "Strava"
        case .account: "Account"
        case .about: "About"
        case .maps: "Maps"
        }
    }
}

/// A Preferences row that opens a screen. On iPhone it's a button, so the screen can move between
/// the stack and the pane beside Preferences as the phone opens and closes; the one beside is
/// marked. The Mac keeps a plain link.
private struct PageLink<Label: View, Destination: View>: View {
    var page: PreferencesPage
    var selected: PreferencesPage?
    var open: (PreferencesPage) -> Void
    var label: Label
    var destination: Destination

    var body: some View {
        #if os(macOS)
        NavigationLink { destination } label: { label }
        #else
        let isSelected = selected == page
        Button { open(page) } label: {
            HStack(spacing: 8) {
                label
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(.primary)
            .contentShape(.rect)
        }
        .listRowBackground(isSelected ? Color.accentColor.opacity(0.15) : nil)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        #endif
    }
}

/// A menu's choices, plus the saved value when it's something else, so the Picker can show it.
func choices<T: Comparable>(_ standard: [T], keeping saved: T?) -> [T] {
    guard let saved, !standard.contains(saved) else { return standard }
    return (standard + [saved]).sorted()
}

extension RiderSettingsStore {
    /// The loaded settings as a binding. Only used while `settings` is loaded.
    var binding: Binding<RiderSettings> {
        Binding(get: { self.settings ?? .sample }, set: { self.settings = $0 })
    }
}

/// Settings' rounded-square symbol tile.
struct Tile: View {
    static let size: CGFloat = 30
    var symbol: String
    var color: Color
    var symbolColor: Color = .white

    var body: some View {
        // Fitted, so wide glyphs like mountain.2.fill stay inside the tile.
        Image(systemName: symbol)
            .resizable()
            .scaledToFit()
            .fontWeight(.semibold)
            .foregroundStyle(symbolColor)
            .frame(width: 18, height: 18)
            .frame(width: Self.size, height: Self.size)
            .background(color, in: .rect(cornerRadius: 7))
            .overlay { if color == .white { RoundedRectangle(cornerRadius: 7).strokeBorder(.separator) } }
    }
}

/// A Settings row label: tile, title and an optional subtitle.
struct Row: View {
    var title: String
    var symbol: String
    var color: Color
    var symbolColor: Color = .white
    var subtitle: String?

    init(_ title: String, _ symbol: String, _ color: Color, symbolColor: Color = .white, subtitle: String? = nil) {
        self.title = title
        self.symbol = symbol
        self.color = color
        self.symbolColor = symbolColor
        self.subtitle = subtitle
    }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
            }
        } icon: {
            Tile(symbol: symbol, color: color, symbolColor: symbolColor)
        }
    }
}

/// °C/°F, km/h/mph and km/mi, each its own choice. Also the macOS Settings window (⌘,). Kept on the
/// device and, when signed in, saved as `settings.units` and `settings.display` so the extension matches.
public struct UnitsSection: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(PreferencesStore.self) private var local

    public init() {}

    public var body: some View {
        Section("Units") {
            LabeledContent {
                Picker("Temperature", selection: temperature) {
                    Text("°C").tag(TemperatureUnit.celsius)
                    Text("°F").tag(TemperatureUnit.fahrenheit)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            } label: {
                Row("Temperature", "thermometer.medium", .orange)
            }
            LabeledContent {
                Picker("Wind Speed", selection: windSpeed) {
                    Text("km/h").tag(UnitSystem.metric)
                    Text("mph").tag(UnitSystem.imperial)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            } label: {
                Row("Wind Speed", "wind", Color(red: 0.4, green: 0.47, blue: 0.58))
            }
            LabeledContent {
                Picker("Distance", selection: distance) {
                    Text("km").tag(UnitSystem.metric)
                    Text("mi").tag(UnitSystem.imperial)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            } label: {
                Row("Distance", "point.topleft.down.to.point.bottomright.curvepath", .purple)
            }
        }
        .sensoryFeedback(.selection, trigger: local.preferences.temperatureUnit)
        .sensoryFeedback(.selection, trigger: local.preferences.speedSystem)
        .sensoryFeedback(.selection, trigger: local.preferences.unitSystem)
    }

    private var temperature: Binding<TemperatureUnit> {
        Binding(
            get: { local.preferences.temperatureUnit ?? (UnitTemperature(forLocale: .current, usage: .weather) == .fahrenheit ? .fahrenheit : .celsius) },
            set: { local.preferences.temperatureUnit = $0; saveUnits() }
        )
    }

    private var windSpeed: Binding<UnitSystem> {
        Binding(
            get: { local.preferences.effectiveSpeedSystem },
            set: { local.preferences.speedSystem = $0; saveUnits() }
        )
    }

    private var distance: Binding<UnitSystem> {
        Binding(
            get: { local.preferences.effectiveUnitSystem },
            set: {
                local.preferences.unitSystem = $0
                if store.settings != nil { store.settings?.display = .init(unit: $0 == .metric ? "km" : "mi") }
            }
        )
    }

    private func saveUnits() {
        guard store.settings != nil else { return }
        store.settings?.units = .init(temperature: temperature.wrappedValue.rawValue,
                                      windSpeed: windSpeed.wrappedValue == .metric ? "kmh" : "mph")
    }
}

/// Distance: off by default; on, routes outside the range score a little lower.
struct DistanceView: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.locale) private var locale

    var body: some View {
        let distance = store.binding.preferences.distance
        Form {
            Section {
                Toggle("Prefer a Distance", isOn: Binding(
                    get: { distance.wrappedValue != nil },
                    set: { distance.wrappedValue = $0 ? .init(minKm: 30, maxKm: 60) : nil }))
            } footer: {
                Text("Routes shorter or longer than this score a little lower. They still appear.")
            }
            if let range = distance.wrappedValue {
                Section {
                    Stepper {
                        LabeledContent("Shortest", value: UnitFormat.distance(km: range.minKm, system: unitSystem, fractionDigits: 0, locale: locale))
                    } onIncrement: {
                        distance.wrappedValue?.minKm = min(step(range.minKm, by: 5), range.maxKm)
                    } onDecrement: {
                        distance.wrappedValue?.minKm = max(step(range.minKm, by: -5), 0)
                    }
                    Stepper {
                        LabeledContent("Longest", value: UnitFormat.distance(km: range.maxKm, system: unitSystem, fractionDigits: 0, locale: locale))
                    } onIncrement: {
                        distance.wrappedValue?.maxKm = min(step(range.maxKm, by: 5), 400)
                    } onDecrement: {
                        distance.wrappedValue?.maxKm = max(step(range.maxKm, by: -5), range.minKm)
                    }
                }
                .sensoryFeedback(.selection, trigger: range)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Distance")
        .toolbarTitleDisplayMode(.inline)
    }

    /// 5 km or 5 mi steps, snapped to the nearest 5.
    private func step(_ km: Double, by delta: Double) -> Double {
        let unit = unitSystem == .metric ? 1 : 1.609344
        return (((km / unit) / 5).rounded() * 5 + delta) * unit
    }
}

/// The signed-in account, and the way out.
struct AccountView: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section {
                LabeledContent("Email", value: store.email ?? "Unknown")
                if !store.providers.isEmpty {
                    LabeledContent("Sign-In Methods", value: store.providers
                        .map { ["apple": "Apple", "google": "Google", "passkey": "Passkey"][$0] ?? $0.capitalized }
                        .formatted(.list(type: .and)))
                }
            } footer: {
                Text("Your routes, rides and preferences are kept in your Ride On account.")
            }
            Section {
                Button("Sign Out", role: .destructive) {
                    store.signOut()
                    dismiss()
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Account")
        .toolbarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack { PreferencesView() }
        .environment(RiderSettingsStore(live: false))
        .environment(PreferencesStore())
}

// The open iPhone Duo beside the rail (PaneShape), for the canvas: the simulator can't fold.
#Preview("Open, landscape", traits: .fixedLayout(width: 879, height: 669)) {
    NavigationStack { PreferencesView() }
        .measuresPaneShape()
        .environment(RiderSettingsStore(live: false))
        .environment(PreferencesStore())
}

import SwiftUI
import SwiftData
import Models
import Router
import Services
import SharedUI
import RideUI
import RoutesUI
import PreferencesUI
import OnboardingUI

@main
struct RideOnApp: App {
    private let modelContainer = RideOnModelContainer.make()
    @State private var preferencesStore = PreferencesStore()
    @State private var riderSettings = RiderSettingsStore(live: !FixtureWorld.isEnabled)
    @State private var rideTracker = RideTracker(live: !FixtureWorld.isEnabled)
    @State private var rideBoard = RideBoardStore(live: !FixtureWorld.isEnabled)
    @State private var rideRequest = RideRequest()
    @Environment(\.scenePhase) private var scenePhase

    // Fixture-world gets fully-fixture services (deterministic E2E); every
    // other launch gets `.live` (Phase 6: real WeatherKit/MapKit/HealthKit/
    // Strava — signed with the real team on iOS; Mac Debug WeatherKit stays
    // blocked on the PLA, see CLAUDE.md "Signing").
    private var services: AppServices { FixtureWorld.isEnabled ? .fixtures : .live }

    init() {
        if FixtureWorld.isEnabled {
            FixtureWorld.seed(into: modelContainer.mainContext)
        }
    }

    var body: some Scene {
        WindowGroup {
            AppRootSwitch()
                .environment(\.services, services)
                .environment(preferencesStore)
                .environment(riderSettings)
                .environment(rideTracker)
                .environment(rideBoard)
                .environment(rideRequest)
                .environment(\.unitSystem, preferencesStore.preferences.effectiveUnitSystem)
                .environment(\.speedSystem, preferencesStore.preferences.effectiveSpeedSystem)
                .environment(\.locale, Locale.current.temperatureUnit(preferencesStore.preferences.temperatureUnit))
                .tint(Color.accentColor)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        Task {
                            async let settings: Void = riderSettings.load()
                            async let tracked: Void = rideTracker.load()
                            await rideBoard.refresh()
                            await settings
                            await tracked
                        }
                    } else if phase == .background {
                        scheduleBoardRefresh()
                    }
                }
                .task(id: RefreshWake(phase: scenePhase, date: rideBoard.nextRefresh)) {
                    guard scenePhase == .active, let date = rideBoard.nextRefresh else { return }
                    do { try await Task.sleep(for: .seconds(max(0, date.timeIntervalSinceNow))) }
                    catch { return }
                    await rideBoard.refresh()
                }
                .onChange(of: riderSettings.revision) { _, _ in
                    Task { await rideBoard.refresh(force: true) }
                }
                .onChange(of: rideBoard.board) { _, board in riderSettings.board = board }
                .onReceive(NotificationCenter.default.publisher(for: RideOnAPI.sessionDidChange).receive(on: RunLoop.main)) { _ in
                    riderSettings.clearAccount()
                    rideTracker.clearAccount()
                    Task {
                        await rideBoard.refresh()
                        await riderSettings.load()
                        scheduleBoardRefresh()
                    }
                }
                // The account's units win, so the app and the extension agree. Each is its own choice.
                .onChange(of: riderSettings.settings?.units) { _, units in
                    guard let units else { return }
                    preferencesStore.preferences.temperatureUnit = TemperatureUnit(rawValue: units.temperature)
                    preferencesStore.preferences.speedSystem = units.windSpeed == "mph" ? .imperial : .metric
                }
                .onChange(of: riderSettings.settings?.display) { _, display in
                    guard let display else { return }
                    preferencesStore.preferences.unitSystem = display.unit == "mi" ? .imperial : .metric
                }
                .task(id: WidgetWake(board: widgetBoard, tracked: rideTracker.ride, units: widgetUnits, active: scenePhase == .active)) {
                    await syncWidgets(active: scenePhase == .active)
                }
                .onOpenURL { url in
                    // Before Strava's router, which takes every rideon:// URL.
                    if let link = RideLink(url) {
                        rideRequest.open(link.pick, track: link.track)
                        return
                    }
                    #if os(iOS)
                    if StravaAuthCallbackRouter.shared.handle(url: url) { return }
                    #endif
                    Task { await importOpenedGPX(at: url) }
                }
        }
        .modelContainer(modelContainer)
        .defaultSize(width: 1100, height: 700)
        #if os(iOS)
        .backgroundTask(.appRefresh(RideBoardBackgroundRefresh.identifier)) {
            guard !FixtureWorld.isEnabled else { return }
            await rideBoard.refreshInBackground()
            await syncWidgets(active: false)
            await MainActor.run { scheduleBoardRefresh() }
        }
        #endif
        .commands {
            SidebarCommands()
            ToolbarCommands()
        }

        #if os(macOS)
        // ⌘, — the Mac-native home for display preferences (HIG: every Mac
        // app with preferences has a Settings scene).
        Settings {
            Form {
                UnitsSection()
            }
            .formStyle(.grouped)
            .frame(width: 380)
            .environment(preferencesStore)
            .environment(riderSettings)
        }
        #endif
    }

    private struct RefreshWake: Equatable {
        var phase: ScenePhase
        var date: Date?
    }

    private struct WidgetWake: Equatable {
        var board: RideBoard?
        var tracked: TrackedRide?
        var units: RideWidgetSnapshot.Units
        var active: Bool
    }

    /// The fixture world's widget shows the sample board, as Rides does.
    private var widgetBoard: RideBoard? { FixtureWorld.isEnabled ? .sample : rideBoard.board }

    private var widgetUnits: RideWidgetSnapshot.Units {
        let preferences = preferencesStore.preferences
        return .init(distance: preferences.effectiveUnitSystem, speed: preferences.effectiveSpeedSystem, temperature: preferences.temperatureUnit)
    }

    @MainActor private func syncWidgets(active: Bool) async {
        await WidgetSync.sync(board: widgetBoard, tracked: rideTracker.ride, units: widgetUnits, active: active)
    }

    @MainActor private func scheduleBoardRefresh() {
        #if os(iOS)
        RideBoardBackgroundRefresh.schedule(after: rideBoard.nextRefresh)
        #endif
    }

    /// Share-sheet / "Open in Ride On" GPX handoff — declared in
    /// `project.yml`'s `CFBundleDocumentTypes`/`UTImportedTypeDeclarations`.
    @MainActor
    private func importOpenedGPX(at url: URL) async {
        let importer = RouteImporter(classifyClient: services.classify, elevationClient: services.elevation, modelContext: modelContainer.mainContext)
        _ = try? await importer.importGPX(fileURL: url)
    }
}

/// View construction for a tab lives here (not in Router's `AppTab`) since
/// this is the one target allowed to import every Features package.
@MainActor @ViewBuilder
private func destination(for tab: AppTab) -> some View {
    switch tab {
    case .rides:
        // The fixture world keeps E2E off the network.
        if FixtureWorld.isEnabled { RidesView(board: .sample) } else { LiveRidesView() }
    case .routes: RoutesPage()
    case .preferences: PreferencesView()
    }
}

/// The Routes tab, and the Ride detail its shortlist cards push (RoutesUI can't import RideUI).
private struct RoutesPage: View {
    @Environment(RideBoardStore.self) private var rides
    @State private var sampleLibrary = RouteLibrary.sample
    @Environment(RiderSettingsStore.self) private var settings: RiderSettingsStore?

    var body: some View {
        Group {
            if FixtureWorld.isEnabled { RoutesView(library: $sampleLibrary, board: .sample) } else { LiveRoutesView() }
        }
        .navigationDestination(for: RideBoard.Pick.self) { pick in
            if let board = settings?.board {
                RideDetailView(board: board, pick: board.details[pick.id]?.pick ?? pick,
                               previousPlan: rides.isPreviousPlan(at: .now))
            }
        }
    }
}

/// One tab's `NavigationStack`.
private struct TabPage: View {
    var tab: AppTab

    var body: some View {
        NavigationStack {
            destination(for: tab)
        }
    }
}

/// Phase 5: onboarding shows on first launch only
/// (`PreferencesStore.hasCompletedOnboarding`), then the app reactively
/// swaps to the tab/split root — no relaunch needed since both branches
/// read the same `@Observable` store.
private struct AppRootSwitch: View {
    @Environment(PreferencesStore.self) private var preferencesStore

    var body: some View {
        if preferencesStore.hasCompletedOnboarding {
            RootView()
        } else {
            OnboardingView()
        }
    }
}

/// Tabs on iPhone/compact width; `NavigationSplitView` sidebar on Mac and
/// iPad regular width, per DESIGN-SYSTEM.md §5 breakpoints.
struct RootView: View {
#if os(macOS)
    var body: some View { SplitRoot() }
#else
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        if horizontalSizeClass == .compact {
            TabRoot()
        } else {
            SplitRoot()
        }
    }
#endif
}

private struct TabRoot: View {
    // `-CycleMapCamera` pins the Routes map's camera for screenshots (docs/maps/README.md, WS3), so it
    // opens there.
    @State private var selection = UserDefaults.standard.string(forKey: "CycleMapCamera") != nil ? AppTab.routes : .rides
    @Environment(RideRequest.self) private var request

    var body: some View {
        TabView(selection: $selection) {
            ForEach(AppTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    TabPage(tab: tab)
                }
            }
        }
        // Routes' panel scrolls over a map, so a shrinking tab bar would only uncover more map.
        .tabBarMinimizes(selection != .routes)
        // A widget tap opens its ride.
        .onChange(of: request.pickID) { _, id in if id != nil { selection = .rides } }
    }
}

private extension View {
    // ponytail: DESIGN-SYSTEM.md §5's tab bar row calls for
    // `.tabBarMinimizeBehavior(.onScrollDown)` — iOS-only (macOS uses the
    // sidebar, no minimizing tab bar).
    @ViewBuilder
    func tabBarMinimizes(_ minimizes: Bool) -> some View {
        #if os(iOS)
        self.tabBarMinimizeBehavior(minimizes ? .onScrollDown : .never)
        #else
        self
        #endif
    }
}

private struct SplitRoot: View {
    @State private var selection: AppTab? = .rides
    @Environment(RideRequest.self) private var request

    var body: some View {
        NavigationSplitView {
            List(AppTab.allCases, selection: $selection) { tab in
                Label(tab.title, systemImage: tab.systemImage).tag(tab)
            }
            .listStyle(.sidebar)
            .navigationTitle("Ride On")
        } detail: {
            TabPage(tab: selection ?? .rides)
                .id(selection)
                .backgroundExtensionEffect()
        }
        .macMinWindowSize()
        .onChange(of: request.pickID) { _, id in if id != nil { selection = .rides } }
    }
}

private extension View {
    @ViewBuilder
    func macMinWindowSize() -> some View {
        #if os(macOS)
        self.frame(minWidth: 800, minHeight: 500)
        #else
        self
        #endif
    }
}

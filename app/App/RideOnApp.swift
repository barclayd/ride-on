import SwiftUI
import SwiftData
import Models
import Router
import Services
import SharedUI
import TodayUI
import RoutesUI
import YouUI
import OnboardingUI

@main
struct RideOnApp: App {
    private let modelContainer = RideOnModelContainer.make()
    @State private var preferencesStore = PreferencesStore()

    // Fixture-world gets fully-fixture services (deterministic E2E); every
    // other launch gets `.live` (Phase 6: real WeatherKit/MapKit/HealthKit/
    // Strava, though WeatherKit/HealthKit only actually authorize once
    // Release signing has a real team — see CLAUDE.md "Signing").
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
                .environment(\.unitSystem, preferencesStore.preferences.effectiveUnitSystem)
                .tint(Color.accentColor)
                .onOpenURL { url in
                    #if os(iOS)
                    if StravaAuthCallbackRouter.shared.handle(url: url) { return }
                    #endif
                    Task { await importOpenedGPX(at: url) }
                }
        }
        .modelContainer(modelContainer)
        .defaultSize(width: 1100, height: 700)
        .commands {
            SidebarCommands()
            ToolbarCommands()
            CommandGroup(after: .importExport) {
                Button("Import GPX…") {
                    NotificationCenter.default.post(name: .rideOnImportGPXRequested, object: nil)
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            }
            // Menu-bar twin of Route Detail's Edit toolbar button — enabled
            // only while a route is showing (see `\.routeEditAction`).
            CommandGroup(after: .textEditing) {
                RouteEditMenuItem()
            }
        }

        #if os(macOS)
        // ⌘, — the Mac-native home for display preferences (HIG: every Mac
        // app with preferences has a Settings scene).
        Settings {
            Form {
                UnitsPicker()
            }
            .formStyle(.grouped)
            .frame(width: 380)
            .environment(preferencesStore)
        }
        #endif
    }

    /// Share-sheet / "Open in Ride On" GPX handoff — declared in
    /// `project.yml`'s `CFBundleDocumentTypes`/`UTImportedTypeDeclarations`.
    @MainActor
    private func importOpenedGPX(at url: URL) async {
        let importer = RouteImporter(classifyClient: services.classify, elevationClient: services.elevation, modelContext: modelContainer.mainContext)
        try? await importer.importGPX(fileURL: url)
    }
}

/// The "Edit Route Details…" menu-bar command. Reads the focused Route
/// Detail's edit action so it drives the same sheet the toolbar button opens,
/// and disables itself when no route is focused.
private struct RouteEditMenuItem: View {
    @FocusedValue(\.routeEditAction) private var editAction

    var body: some View {
        Button("Edit Route Details…") { editAction?() }
            .keyboardShortcut("e", modifiers: [.command, .shift])
            .disabled(editAction == nil)
    }
}

/// View construction for a tab lives here (not in Router's `AppTab`) since
/// this is the one target allowed to import every Features package.
/// `namespace` backs the Today card -> Route Detail zoom transition
/// (DESIGN-SYSTEM.md §7); every tab gets one since only the App shell can
/// see both `TodayView`'s `matchedTransitionSource` and the
/// `RouterDestination.routeDetail` push it zooms into.
@MainActor @ViewBuilder
private func destination(for tab: AppTab, namespace: Namespace.ID) -> some View {
    switch tab {
    case .today: TodayView(namespace: namespace)
    case .routes: RoutesView()
    case .you: YouView()
    }
}

/// Turns a cross-feature `RouterDestination` value into a concrete view —
/// the one place that can, since only the App shell imports every Features
/// product (TodayUI/RoutesUI/YouUI can't import each other).
@MainActor @ViewBuilder
private func routeDetailDestination(_ destination: RouterDestination, namespace: Namespace.ID) -> some View {
    switch destination {
    case .routeDetail(let routeID):
        RouteDetailView(routeID: routeID)
            .zoomTransitionIfAvailable(sourceID: routeID, in: namespace)
    }
}

// ponytail: `.zoom` navigation transition is iOS-only (unavailable on
// macOS) — Mac gets a plain push, no zoom, per DESIGN-SYSTEM.md §7's
// "reduced motion is always a valid fallback" spirit.
private extension View {
    @ViewBuilder
    func zoomTransitionIfAvailable(sourceID: some Hashable, in namespace: Namespace.ID) -> some View {
        #if os(iOS)
        self.navigationTransition(.zoom(sourceID: sourceID, in: namespace))
        #else
        self
        #endif
    }
}

/// One tab's `NavigationStack` + the `Namespace` its zoom transition shares
/// between the Today card and the pushed Route Detail.
private struct TabPage: View {
    var tab: AppTab
    @Namespace private var cardNamespace

    var body: some View {
        NavigationStack {
            destination(for: tab, namespace: cardNamespace)
                .navigationDestination(for: RouterDestination.self) { destination in
                    routeDetailDestination(destination, namespace: cardNamespace)
                }
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
    var body: some View {
        TabView {
            ForEach(AppTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage) {
                    TabPage(tab: tab)
                }
            }
        }
        .tabBarMinimizeBehaviorIfAvailable()
    }
}

private extension View {
    // ponytail: DESIGN-SYSTEM.md §5's tab bar row calls for
    // `.tabBarMinimizeBehavior(.onScrollDown)` — iOS-only (macOS uses the
    // sidebar, no minimizing tab bar).
    @ViewBuilder
    func tabBarMinimizeBehaviorIfAvailable() -> some View {
        #if os(iOS)
        self.tabBarMinimizeBehavior(.onScrollDown)
        #else
        self
        #endif
    }
}

private struct SplitRoot: View {
    @State private var selection: AppTab? = .today
    @State private var selectedRouteID: UUID?

    var body: some View {
        // Landmarks idiom (REDESIGN.md A): on Mac/iPad the routes list is a
        // content column driving Route Detail in the detail column, not a
        // push over itself. Today/You keep the plain two-column layout, so
        // the split view is swapped per tab.
        Group {
            if selection == .routes {
                NavigationSplitView {
                    sidebar
                } content: {
                    RoutesView(selection: $selectedRouteID)
                        .navigationSplitViewColumnWidth(min: 300, ideal: 340)
                } detail: {
                    if let selectedRouteID {
                        RouteDetailView(routeID: selectedRouteID)
                    } else {
                        ContentUnavailableView("Select a Route", systemImage: "map")
                    }
                }
            } else {
                NavigationSplitView {
                    sidebar
                } detail: {
                    TabPage(tab: selection ?? .today)
                        .backgroundExtensionEffect()
                }
            }
        }
        .macMinWindowSize()
        // ponytail: fixture-only debug hook — land on Route Detail with zero
        // clicks so its layout can be reproduced/screenshotted headlessly.
        .onAppear {
            if FixtureWorld.isEnabled, ProcessInfo.processInfo.arguments.contains("--select-first-route") {
                selection = .routes
                selectedRouteID = FixtureWorld.sampleRoute.id
            }
        }
    }

    private var sidebar: some View {
        List(AppTab.allCases, selection: $selection) { tab in
            Label(tab.title, systemImage: tab.systemImage).tag(tab)
        }
        .listStyle(.sidebar)
        .navigationTitle("Ride On")
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

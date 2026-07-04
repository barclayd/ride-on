import SwiftUI
import SwiftData
import Router
import Services
import TodayUI
import RoutesUI
import YouUI
import OnboardingUI

@main
struct RideOnApp: App {
    private let modelContainer = RideOnModelContainer.make()
    @State private var preferencesStore = PreferencesStore()

    // Fixture-world gets fully-fixture services (deterministic E2E); every
    // other launch gets `.live`, which today only means a real `/classify`
    // — the rest of AppServices stays fixture-backed until Phase 6.
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
                .tint(Color.accentColor)
                .onOpenURL { url in
                    Task { await importOpenedGPX(at: url) }
                }
        }
        .modelContainer(modelContainer)
    }

    /// Share-sheet / "Open in Ride On" GPX handoff — declared in
    /// `project.yml`'s `CFBundleDocumentTypes`/`UTImportedTypeDeclarations`.
    @MainActor
    private func importOpenedGPX(at url: URL) async {
        let importer = RouteImporter(classifyClient: services.classify, modelContext: modelContainer.mainContext)
        try? await importer.importGPX(fileURL: url)
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

    var body: some View {
        NavigationSplitView {
            List(AppTab.allCases, selection: $selection) { tab in
                Label(tab.title, systemImage: tab.systemImage).tag(tab)
            }
            .navigationTitle("Ride On")
        } detail: {
            TabPage(tab: selection ?? .today)
        }
    }
}

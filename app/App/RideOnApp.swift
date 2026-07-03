import SwiftUI
import SwiftData
import Router
import Services
import TodayUI
import RoutesUI
import YouUI

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
            RootView()
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
@MainActor @ViewBuilder
private func destination(for tab: AppTab) -> some View {
    switch tab {
    case .today: TodayView()
    case .routes: RoutesView()
    case .you: YouView()
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
                    NavigationStack {
                        destination(for: tab)
                    }
                }
            }
        }
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
            NavigationStack {
                destination(for: selection ?? .today)
            }
        }
    }
}

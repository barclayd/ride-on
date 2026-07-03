import SwiftUI
import SwiftData

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

enum AppTab: String, CaseIterable, Identifiable {
    case today, routes, you

    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .routes: "Routes"
        case .you: "You"
        }
    }

    var systemImage: String {
        switch self {
        case .today: "bicycle"
        case .routes: "map"
        case .you: "person.crop.circle"
        }
    }

    @ViewBuilder
    var destination: some View {
        switch self {
        case .today: TodayView()
        case .routes: RoutesView()
        case .you: YouView()
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
                    NavigationStack {
                        tab.destination
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
                (selection ?? .today).destination
            }
        }
    }
}

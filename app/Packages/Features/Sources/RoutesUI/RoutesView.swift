import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import Models
import Services
import Router
import DesignSystem
import SharedUI

extension UTType {
    /// Declared in `project.yml`'s `UTImportedTypeDeclarations`.
    static var gpx: UTType {
        UTType(importedAs: "com.topografix.gpx")
    }
}

private enum RouteChip: String, CaseIterable, Identifiable {
    case road = "Road"
    case gravel = "Gravel"
    case under2h = "Under 2h"
    case notRiddenLately = "Not ridden lately"

    var id: String { rawValue }
}

private enum LibraryFilter: String, CaseIterable {
    case saved = "Saved"
    case ridden = "Ridden"
}

/// Routes library per DESIGN-SYSTEM.md §9: searchable list, suggestion
/// chips, Saved/Ridden toggle, swipe actions, GPX import entry point.
public struct RoutesView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.services) private var services
    @Environment(PreferencesStore.self) private var preferencesStore
    @Query(sort: \RouteModel.createdAt, order: .reverse) private var routes: [RouteModel]
    @Query private var rideLogModels: [RideLogModel]

    @State private var isImporterPresented = false
    @State private var pendingConfirmation: RouteModel?
    @State private var importErrorMessage: String?
    @State private var searchText = ""
    @State private var activeChips: Set<RouteChip> = []
    @State private var libraryFilter: LibraryFilter = .saved

    /// Non-nil on Mac/iPad regular width, where the list drives the split
    /// view's detail column via selection (Landmarks idiom) instead of
    /// pushing Route Detail over itself. nil = iPhone push navigation.
    private var selection: Binding<UUID?>?

    public init(selection: Binding<UUID?>? = nil) {
        self.selection = selection
    }

    public var body: some View {
        Group {
            if routes.isEmpty {
                ContentUnavailableView(
                    "No Routes Yet",
                    systemImage: "map",
                    description: Text("Import a GPX file to get started.")
                )
            } else {
                VStack(spacing: 0) {
                    // On Mac the Saved/Ridden scope switch lives in the
                    // toolbar (HIG: scope controls belong with the window
                    // chrome, and an in-content macOS Picker paints its
                    // "Library" label); iPhone keeps it in-content.
                    #if !os(macOS)
                    libraryPicker
                        .pickerStyle(.segmented)
                        .padding(.horizontal)
                        .padding(.top, 8)
                    #endif

                    // Maps' pre-typed suggestion pattern (DESIGN-SYSTEM §9):
                    // the chips live under the focused search field via
                    // `.searchSuggestions`; this inline row only appears once
                    // a filter is active, so it stays visible and removable.
                    if !activeChips.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(RouteChip.allCases) { chip in
                                    chipButton(chip)
                                }
                            }
                            .padding(.horizontal)
                            .padding(.vertical, 8)
                        }
                    }

                    if filteredRoutes.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                    } else {
                        List(selection: selection) {
                            ForEach(filteredRoutes) { route in
                                row(for: route)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            if selection?.wrappedValue == route.id {
                                                selection?.wrappedValue = nil
                                            }
                                            modelContext.delete(route)
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        }
                        #if os(macOS)
                        .listStyle(.inset(alternatesRowBackgrounds: true))
                        #else
                        .listStyle(.plain)
                        #endif
                    }
                }
            }
        }
        .navigationTitle("Routes")
        .searchable(text: $searchText, prompt: "Search routes")
        .searchSuggestions {
            ForEach(RouteChip.allCases) { chip in
                Button {
                    toggle(chip)
                } label: {
                    Label(chip.rawValue, systemImage: activeChips.contains(chip) ? "checkmark.circle.fill" : "circle")
                }
            }
        }
        .toolbar {
            #if os(macOS)
            ToolbarItem(placement: .principal) {
                libraryPicker
                    .pickerStyle(.segmented)
                    .labelsHidden()
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button("Import", systemImage: "square.and.arrow.down") {
                    isImporterPresented = true
                }
            }
        }
        .fileImporter(
            isPresented: $isImporterPresented,
            allowedContentTypes: [.gpx, .xml],
            allowsMultipleSelection: true
        ) { result in
            handleImport(result)
        }
        // Drag a GPX file anywhere onto the screen (Finder on Mac, Files on
        // iPad) — same pipeline as the file importer; RouteImporter handles
        // security-scoped access. `onDrop` + `.fileURL`, not
        // `.dropDestination(for: URL.self)` — the latter never matches
        // Finder's `public.file-url` drags on macOS.
        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
            handleDrop(providers)
        }
        .sheet(item: $pendingConfirmation) { route in
            ImportConfirmationSheet(route: route)
        }
        .alert("Import Failed", isPresented: .constant(importErrorMessage != nil), presenting: importErrorMessage) { _ in
            Button("OK") { importErrorMessage = nil }
        } message: { message in
            Text(message)
        }
        // Mac File menu > "Import GPX…" (RideOnApp's `.commands`) — a
        // scene-level command has no direct view reference, so it signals
        // over `NotificationCenter` instead.
        .onReceive(NotificationCenter.default.publisher(for: .rideOnImportGPXRequested)) { _ in
            isImporterPresented = true
        }
    }

    @ViewBuilder
    private func row(for route: RouteModel) -> some View {
        if selection != nil {
            RouteRow(route: route)
                .tag(route.id)
        } else {
            NavigationLink(value: RouterDestination.routeDetail(routeID: route.id)) {
                RouteRow(route: route)
            }
        }
    }

    private var libraryPicker: some View {
        Picker("Library", selection: $libraryFilter) {
            ForEach(LibraryFilter.allCases, id: \.self) { filter in
                Text(filter.rawValue).tag(filter)
            }
        }
    }

    private func toggle(_ chip: RouteChip) {
        if activeChips.contains(chip) { activeChips.remove(chip) } else { activeChips.insert(chip) }
    }

    private func chipButton(_ chip: RouteChip) -> some View {
        let isActive = activeChips.contains(chip)
        return Button {
            toggle(chip)
        } label: {
            Text(chip.rawValue)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isActive ? Color.accentColor : Color.secondary.opacity(0.15), in: .capsule)
                .foregroundStyle(isActive ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }

    private var riddenRouteIDs: Set<UUID> {
        Set(rideLogModels.compactMap(\.routeID))
    }

    private var filteredRoutes: [RouteModel] {
        routes.filter { route in
            matchesSearch(route) && matchesFilter(route) && matchesChips(route)
        }
    }

    private func matchesSearch(_ route: RouteModel) -> Bool {
        searchText.isEmpty || route.name.localizedCaseInsensitiveContains(searchText)
    }

    private func matchesFilter(_ route: RouteModel) -> Bool {
        switch libraryFilter {
        case .saved: true
        case .ridden: riddenRouteIDs.contains(route.id)
        }
    }

    private func matchesChips(_ route: RouteModel) -> Bool {
        activeChips.allSatisfy { chip in
            switch chip {
            case .road: route.effectiveType == .road
            case .gravel: route.effectiveType == .gravel
            case .under2h: RouteStats.estimatedRideTime(for: route, preferences: preferencesStore.preferences) < 2 * 3600
            case .notRiddenLately: !recentlyRidden(route)
            }
        }
    }

    private func recentlyRidden(_ route: RouteModel) -> Bool {
        let cutoff = Date.now.addingTimeInterval(-14 * 86400)
        return rideLogModels.contains { $0.routeID == route.id && $0.date > cutoff }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        let urlProviders = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
        guard !urlProviders.isEmpty else { return false }
        for provider in urlProviders {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url, ["gpx", "xml"].contains(url.pathExtension.lowercased()) else { return }
                Task { @MainActor in
                    handleImport(.success([url]))
                }
            }
        }
        return true
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        let importer = RouteImporter(classifyClient: services.classify, elevationClient: services.elevation, modelContext: modelContext)
        Task {
            for url in urls {
                do {
                    let model = try await importer.importGPX(fileURL: url)
                    pendingConfirmation = model
                } catch {
                    importErrorMessage = "Couldn't read that GPX file."
                }
            }
        }
    }
}

/// Not a DESIGN-SYSTEM.md §6 component — a plain list row built from stock
/// views (the closed 8-component inventory doesn't need a 9th for this).
private struct RouteRow: View {
    var route: RouteModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.unitSystem) private var unitSystem
    // Scales with Dynamic Type so the thumbnail keeps pace with the row's
    // text instead of shrinking relative to it (REDESIGN.md @ScaledMetric).
    @ScaledMetric(relativeTo: .headline) private var thumbnailSize: CGFloat = 56
    @State private var thumbnail: PlatformImage?

    var body: some View {
        HStack(spacing: 12) {
            thumbnailView
                .frame(width: thumbnailSize, height: thumbnailSize)
                .clipShape(.rect(cornerRadius: CornerRadius.thumbnail))

            VStack(alignment: .leading, spacing: 2) {
                Text(route.name)
                    .font(.headline)
                Text(route.hasElevationData
                    ? "\(UnitFormat.distance(km: route.distanceKm, system: unitSystem)) · \(UnitFormat.elevation(m: route.elevationGainM, system: unitSystem)) gain"
                    : "\(UnitFormat.distance(km: route.distanceKm, system: unitSystem)) · no elevation data")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let type = route.effectiveType {
                Text(type.rawValue.capitalized)
                    .tagCapsule()
            } else if route.needsClassification {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Classification pending")
            }
        }
        .task(id: route.id) {
            thumbnail = await RouteSnapshotService.snapshot(
                routeID: route.id,
                coordinates: route.coordinates,
                size: CGSize(width: 112, height: 112),
                colorScheme: colorScheme
            )
        }
    }

    // ponytail: `.scaledToFill()`'s aspect-corrected ideal size can exceed
    // what's proposed — pinning the frame + `.clipped()` here (not just at
    // the call site) stops that oversized size from leaking into the HStack
    // layout (see RideCard's `mapLayer` for the same fix, full explanation).
    @ViewBuilder
    private var thumbnailView: some View {
        if let thumbnail {
            Image(platformImage: thumbnail).resizable().scaledToFill()
                .frame(width: thumbnailSize, height: thumbnailSize)
                .clipped()
        } else {
            Rectangle().fill(.secondary.opacity(0.15))
        }
    }
}

/// Confirmation step after import: map snapshot hero, name + stats as
/// title/subtitle, one segmented type control (Landmarks' add-sheet idiom —
/// a grouped Form here rendered as a jumbled label column on macOS).
/// DESIGN-SYSTEM.md §2: system glass sheet at `.medium`, no manual
/// `.presentationBackground`.
private struct ImportConfirmationSheet: View {
    var route: RouteModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.colorScheme) private var colorScheme
    @State private var selection: SuggestedRouteType
    @State private var snapshot: PlatformImage?

    private static let snapshotSize = CGSize(width: 360, height: 160)

    init(route: RouteModel) {
        self.route = route
        _selection = State(initialValue: route.effectiveType ?? .gravel)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Group {
                    if let snapshot {
                        Image(platformImage: snapshot).resizable().scaledToFill()
                    } else {
                        Rectangle().fill(.secondary.opacity(0.15))
                    }
                }
                .frame(maxWidth: Self.snapshotSize.width)
                .frame(height: Self.snapshotSize.height)
                .clipShape(.rect(cornerRadius: CornerRadius.hero))

                VStack(spacing: 4) {
                    Text(route.name)
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                    Text(subtitle)
                        .foregroundStyle(.secondary)
                }

                Picker("Type", selection: $selection) {
                    ForEach(SuggestedRouteType.allCases, id: \.self) { type in
                        Text(type.rawValue.capitalized).tag(type)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: Self.snapshotSize.width)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("New Route")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        route.userOverriddenType = selection
                        // Classify failed (e.g. Valhalla outage): the user's
                        // pick IS the classification — resolve the pending
                        // state instead of promising a retry that never runs.
                        if route.needsClassification {
                            route.surfaces = assumedSurfaces(for: selection, distanceKm: route.distanceKm)
                            route.needsClassification = false
                        }
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .presentationDetents([.medium])
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 380)
        #endif
        .task {
            snapshot = await RouteSnapshotService.snapshot(
                routeID: route.id,
                coordinates: route.coordinates,
                size: CGSize(width: Self.snapshotSize.width * 2, height: Self.snapshotSize.height * 2),
                colorScheme: colorScheme
            )
        }
    }

    private var subtitle: String {
        let distance = UnitFormat.distance(km: route.distanceKm, system: unitSystem)
        guard route.hasElevationData else { return "\(distance) · no elevation data" }
        return "\(distance) · \(UnitFormat.elevation(m: route.elevationGainM, system: unitSystem)) gain"
    }

    // ponytail: coarse single-bucket breakdown from the user's type pick —
    // real per-edge surfaces come from /classify when Valhalla is reachable.
    private func assumedSurfaces(for type: SuggestedRouteType, distanceKm: Double) -> SurfaceBreakdown {
        switch type {
        case .road: SurfaceBreakdown(distanceKmBySurface: [.paved: distanceKm])
        case .gravel: SurfaceBreakdown(distanceKmBySurface: [.unpaved: distanceKm])
        case .mixed: SurfaceBreakdown(distanceKmBySurface: [.paved: distanceKm / 2, .unpaved: distanceKm / 2])
        }
    }
}

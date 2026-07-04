import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import Models
import Services
import Router
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

    public init() {}

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
                    Picker("Library", selection: $libraryFilter) {
                        ForEach(LibraryFilter.allCases, id: \.self) { filter in
                            Text(filter.rawValue).tag(filter)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.top, 8)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(RouteChip.allCases) { chip in
                                chipButton(chip)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                    }

                    if filteredRoutes.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                    } else {
                        List {
                            ForEach(filteredRoutes) { route in
                                NavigationLink(value: RouterDestination.routeDetail(routeID: route.id)) {
                                    RouteRow(route: route)
                                }
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        modelContext.delete(route)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        }
                        .listStyle(.plain)
                    }
                }
            }
        }
        .navigationTitle("Routes")
        .searchable(text: $searchText, prompt: "Search routes")
        .toolbar {
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

    private func chipButton(_ chip: RouteChip) -> some View {
        let isActive = activeChips.contains(chip)
        return Button {
            if isActive { activeChips.remove(chip) } else { activeChips.insert(chip) }
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

    private func handleImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        let importer = RouteImporter(classifyClient: services.classify, modelContext: modelContext)
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
    @State private var thumbnail: PlatformImage?

    var body: some View {
        HStack(spacing: 12) {
            thumbnailView
                .frame(width: 56, height: 56)
                .clipShape(.rect(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(route.name)
                    .font(.headline)
                Text("\(UnitFormat.distance(km: route.distanceKm)) · \(UnitFormat.elevation(m: route.elevationGainM)) gain")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if let type = route.effectiveType {
                Text(type.rawValue.capitalized)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.secondary.opacity(0.15), in: .capsule)
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
            #if os(macOS)
            Image(nsImage: thumbnail).resizable().scaledToFill()
                .frame(width: 56, height: 56)
                .clipped()
            #else
            Image(uiImage: thumbnail).resizable().scaledToFill()
                .frame(width: 56, height: 56)
                .clipped()
            #endif
        } else {
            Rectangle().fill(.secondary.opacity(0.15))
        }
    }
}

/// Confirmation step after import: shows the classifier's suggestion (or a
/// "pending" note if classify failed) with a picker to override it.
/// DESIGN-SYSTEM.md §2: system glass sheet at `.medium`, no manual
/// `.presentationBackground`.
private struct ImportConfirmationSheet: View {
    var route: RouteModel
    @Environment(\.dismiss) private var dismiss
    @State private var selection: SuggestedRouteType

    init(route: RouteModel) {
        self.route = route
        _selection = State(initialValue: route.effectiveType ?? .gravel)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Route") {
                    LabeledContent("Name", value: route.name)
                    LabeledContent("Distance", value: UnitFormat.distance(km: route.distanceKm))
                    LabeledContent("Elevation Gain", value: UnitFormat.elevation(m: route.elevationGainM))
                }
                Section("Type") {
                    if route.needsClassification {
                        Label("Classification unavailable — you can retry later.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                            .font(.footnote)
                    }
                    Picker("Type", selection: $selection) {
                        ForEach(SuggestedRouteType.allCases, id: \.self) { type in
                            Text(type.rawValue.capitalized).tag(type)
                        }
                    }
                }
            }
            .navigationTitle("Confirm Import")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        route.userOverriddenType = selection
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import Models
import Services

extension UTType {
    /// Declared in `project.yml`'s `UTImportedTypeDeclarations`.
    static var gpx: UTType {
        UTType(importedAs: "com.topografix.gpx")
    }
}

/// Routes library (Phase 4 will add search/chips/swipe actions per
/// DESIGN-SYSTEM.md §9); Phase 2 wires the real data path: import, list,
/// classify-confirmation sheet.
public struct RoutesView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.services) private var services
    @Query(sort: \RouteModel.createdAt, order: .reverse) private var routes: [RouteModel]

    @State private var isImporterPresented = false
    @State private var pendingConfirmation: RouteModel?
    @State private var importErrorMessage: String?

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
                List(routes) { route in
                    RouteRow(route: route)
                }
            }
        }
        .navigationTitle("Routes")
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
                Text("\(route.distanceKm.formatted(.number.precision(.fractionLength(1)))) km · \(Int(route.elevationGainM))m gain")
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

    @ViewBuilder
    private var thumbnailView: some View {
        if let thumbnail {
            #if os(macOS)
            Image(nsImage: thumbnail).resizable().scaledToFill()
            #else
            Image(uiImage: thumbnail).resizable().scaledToFill()
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
                    LabeledContent("Distance", value: "\(route.distanceKm.formatted(.number.precision(.fractionLength(1)))) km")
                    LabeledContent("Elevation Gain", value: "\(Int(route.elevationGainM)) m")
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
                }
            }
        }
        .presentationDetents([.medium])
    }
}

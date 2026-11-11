import SwiftUI
import UniformTypeIdentifiers
import RouteFiles
import Networking

/// The same compact, system-styled flow for Open In, Files and the share extension.
public struct RouteImportSheet: View {
    private let load: @Sendable () async throws -> RouteFile
    private let close: (@MainActor () -> Void)?
    @State private var route: RouteFile?
    @State private var error: String?
    @State private var saving = false
    @State private var receipt: RouteFile.Receipt?
    @Environment(\.dismiss) private var dismiss
    #if os(iOS)
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    #endif

    public init(load: @escaping @Sendable () async throws -> RouteFile, close: (@MainActor () -> Void)? = nil) {
        self.load = load
        self.close = close
    }

    public init(fileURL: URL) {
        self.init(load: { try await Task.detached { try RouteFile.read(fileURL) }.value })
    }

    public var body: some View {
        NavigationStack {
            Group {
                if let receipt {
                    ContentUnavailableView(receipt.outcome == "unchanged" ? "Already in Your Library" : "Added to Your Library",
                                           systemImage: "checkmark.circle",
                                           description: Text("“\(receipt.route.name)” is saved in Ride On. Track it from Routes when you're ready."))
                } else if route != nil {
                    Form {
                        Section("Route") {
                            TextField("Route name", text: Binding(get: { route?.name ?? "" }, set: { route?.name = $0 }))
                                .accessibilityIdentifier("import-route-name")
                            LabeledContent("Source", value: "Direct import")
                        }
                        Section {
                            Label("Saved to your route library", systemImage: "books.vertical")
                        } footer: {
                            Text("You can choose whether to track this route in Ride On.")
                        }
                        if let error {
                            Section {
                                Label(error, systemImage: "exclamationmark.triangle")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .formStyle(.grouped)
                    .disabled(saving)
                } else if let error {
                    ContentUnavailableView("Couldn't Read Route", systemImage: "doc.badge.ellipsis", description: Text(error))
                } else {
                    ProgressView("Reading route…")
                }
            }
            .navigationTitle("Import Route")
            #if os(iOS)
            .navigationBarTitleDisplayMode(toolbarVerticalEdge == nil ? .inline : .large)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { finish() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if receipt != nil {
                        Button("Done", systemImage: "checkmark", role: .confirm) { finish() }
                    } else if route != nil {
                        Button("Import", systemImage: "square.and.arrow.down", role: .confirm) {
                            Task { await save() }
                        }
                        .disabled(saving || !validName)
                        .accessibilityIdentifier("import-route-save")
                    }
                }
            }
            .overlay { if saving { ProgressView("Adding route…").padding().background(.regularMaterial, in: .rect(cornerRadius: 16)) } }
        }
        .tint(Color.accentColor)
        .interactiveDismissDisabled(saving)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task {
            guard route == nil, error == nil else { return }
            do { route = try await load() }
            catch { self.error = error.localizedDescription }
        }
    }

    private var validName: Bool {
        guard let name = route?.name.trimmingCharacters(in: .whitespacesAndNewlines) else { return false }
        return !name.isEmpty && name.utf16.count <= 160
    }

    private func finish() { if let close { close() } else { dismiss() } }

    private func save() async {
        guard let route, !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            receipt = try await route.save()
            NotificationCenter.default.post(name: .routeLibraryDidImport, object: nil)
        } catch { self.error = error.localizedDescription }
    }
}

public extension Notification.Name {
    static let routeLibraryDidImport = Notification.Name("RideOnRouteLibraryDidImport")
}

public extension View {
    func routeFileImporter(isPresented: Binding<Bool>) -> some View {
        modifier(RouteFilePicker(isPresented: isPresented))
    }
}

private struct RouteFilePicker: ViewModifier {
    @Binding var isPresented: Bool
    @State private var selection: Selection?
    @State private var error: String?
    private struct Selection: Identifiable { let id = UUID(); let url: URL }

    func body(content: Content) -> some View {
        content.fileImporter(isPresented: $isPresented,
                             allowedContentTypes: [UTType(importedAs: "com.topografix.gpx"), UTType(importedAs: "com.garmin.fit")]) { result in
            switch result {
            case .success(let url): selection = Selection(url: url)
            case .failure(let failure): error = failure.localizedDescription
            }
        }
        .sheet(item: $selection) { RouteImportSheet(fileURL: $0.url) }
        .alert("Couldn't Open File", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
    }
}

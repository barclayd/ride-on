import SwiftUI
import Models
import Services
import DesignSystem
import SharedUI

/// Track a Route, from Rides' + (docs/redesign/README.md §10): your saved routes, each with a
/// toggle that puts it on the shortlist Rides ranks or takes it off, and where new routes come
/// from. A toggle saves straight away with `PUT /route-selection`, as Routes does, then `onSaved`
/// reloads Rides. On the iPhone Duo's rail, Close sits at the top (DESIGN-SYSTEM.md §5).
public struct TrackRouteSheet: View {
    private enum Phase { case loading, signedOut, failed(String), loaded }

    var onSaved: @MainActor @Sendable () async -> Void
    @State private var phase = Phase.loading
    @State private var library = RouteLibrary(routes: [], shortlist: [], rides: [])
    /// The shortlist as the API last confirmed it; edits save over it. `nil` in the fixture world,
    /// where edits stay in the sheet.
    @State private var saved: RouteLibraryLoader.Shortlist?
    @State private var saving = false
    @State private var saveError: String?
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss
    #if os(iOS)
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    #endif

    public init(onSaved: @escaping @MainActor @Sendable () async -> Void = {}) {
        self.onSaved = onSaved
    }

    /// Opens on `library`, for previews.
    init(library: RouteLibrary) {
        onSaved = {}
        _library = State(initialValue: library)
        _phase = State(initialValue: .loaded)
    }

    private var onRail: Bool {
        #if os(iOS)
        toolbarVerticalEdge != nil
        #else
        false
        #endif
    }

    public var body: some View {
        NavigationStack {
            content
                .navigationTitle("Track a Route")
                #if os(iOS)
                // The rail has no title, so it heads the content there.
                .navigationBarTitleDisplayMode(onRail ? .large : .inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(role: .close) { dismiss() }
                            .tint(.primary)
                    }
                }
        }
        .task { await load() }
        .onChange(of: library.shortlist) { Task { await save() } }
        .alert("Couldn't Save Your Routes", isPresented: Binding { saveError != nil } set: { if !$0 { saveError = nil } }) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(saveError ?? "")
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
        case .signedOut:
            ContentUnavailableView("Sign In to Track Routes", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                   description: Text("Sign in on the Rides tab to see your routes."))
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Routes", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    phase = .loading
                    Task { await load() }
                }
            }
        case .loaded:
            form
        }
    }

    private var form: some View {
        Form {
            Section {
                let routes = library.routes.filter(matches)
                if routes.isEmpty {
                    Text(library.routes.isEmpty ? "Routes you import appear here." : "No routes match “\(query)”.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(routes) { route in
                        TrackRouteRow(route: route, isTracked: library.shortlist.contains(route.id),
                                      canTrack: canTrack) { toggle(route) }
                    }
                }
            } header: {
                HStack {
                    Text("Your Routes")
                    Spacer()
                    Text("\(library.shortlist.count) of \(library.shortlistLimit) tracked")
                        .monospacedDigit()
                }
            } footer: {
                Text(canTrack
                     ? "Ride On picks your best ride from the routes you track."
                     : "You’re tracking \(library.shortlistLimit) routes, the most Rides ranks. Stop tracking one to add another.")
            }

            Section("Import") {
                // ponytail: no-ops until the import flows are rebuilt on the API, as in Routes' Add Routes menu.
                Button {} label: {
                    ImportLabel("From a GPX File", systemImage: "doc")
                }
                Button {} label: {
                    ImportLabel("From cycle.travel", detail: "With the Ride On browser extension", systemImage: "safari")
                }
                Button {} label: {
                    ImportLabel("From Strava", detail: "Coming soon", systemImage: "link")
                }
                .disabled(true)
            }
        }
        .formStyle(.grouped)
        .searchable(text: $query, prompt: "Search Your Routes")
    }

    private var canTrack: Bool { library.shortlist.count < library.shortlistLimit }

    private func matches(_ route: RouteLibrary.Route) -> Bool {
        let query = query.trimmingCharacters(in: .whitespaces)
        return query.isEmpty || route.name.localizedStandardContains(query) || route.source.title.localizedStandardContains(query)
    }

    private func toggle(_ route: RouteLibrary.Route) {
        withAnimation(Motion.glassTapLayout) {
            if let index = library.shortlist.firstIndex(of: route.id) {
                library.shortlist.remove(at: index)
            } else if canTrack {
                library.shortlist.append(route.id)
            }
        }
    }

    // MARK: Loading and saving (as LiveRoutesView)

    private var isLoaded: Bool {
        if case .loaded = phase { true } else { false }
    }

    private func load() async {
        // A preview opens loaded, with nothing to save over.
        if isLoaded && saved == nil { return }
        if FixtureWorld.isEnabled {
            library = .sample
            phase = .loaded
            return
        }
        guard RideOnAPI.isSignedIn else { phase = .signedOut; return }
        do {
            let (loaded, shortlist) = try await RouteLibraryLoader.load()
            library = loaded
            saved = shortlist
            phase = .loaded
        } catch let failure as RideOnAPI.Failure where failure.status == 401 {
            phase = .signedOut
        } catch where Task.isCancelled {
            // The sheet closed mid-load.
        } catch {
            if !isLoaded { phase = .failed(error.localizedDescription) }
        }
    }

    /// Saves the shortlist until it matches what the API has, folding in toggles made while a save
    /// was in flight. A failed save puts the shortlist back as the API last had it.
    private func save() async {
        guard !saving, var current = saved, library.shortlist != current.routeIDs else { return }
        saving = true
        do {
            while library.shortlist != current.routeIDs {
                let desired = library.shortlist
                current = try await RouteLibraryLoader.save(desired, over: current)
                saved = current
                library.shortlist = RouteLibraryLoader.merge(library.shortlist, base: desired, onto: current.routeIDs)
            }
            saving = false
        } catch let failure as RideOnAPI.Failure where failure.status == 401 {
            saving = false
            phase = .signedOut
            return
        } catch let failure as RideOnAPI.Failure where failure.status == 404 {
            // A route was deleted since the sheet loaded.
            saving = false
            library.shortlist = current.routeIDs
            await load()
            return
        } catch {
            saving = false
            library.shortlist = current.routeIDs
            saveError = error.localizedDescription
            return
        }
        await onSaved()
    }
}

/// A saved route with its outline and stats, and a toggle that tracks it.
private struct TrackRouteRow: View {
    var route: RouteLibrary.Route
    var isTracked: Bool
    /// False once the shortlist is full.
    var canTrack: Bool
    var toggle: () -> Void

    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                RouteMap(route.coordinates, style: .thumbnail)
                    .frame(width: 48, height: 48)
                    .clipShape(.rect(cornerRadius: CornerRadius.panelThumbnail))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(route.name)
                        .font(.headline)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                    Text(route.statsLine(unitSystem))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: isTracked ? "checkmark.circle.fill" : "plus.circle")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 44, height: 44)
                    .accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!isTracked && !canTrack)
        .accessibilityElement(children: .combine)
        .accessibilityValue(isTracked ? "Tracked" : "")
        .accessibilityAddTraits(isTracked ? .isSelected : [])
        .accessibilityHint(isTracked ? "Stops tracking it" : "Tracks it on Rides")
        .sensoryFeedback(.selection, trigger: isTracked)
    }
}

/// An import source: its symbol, then its title and what it needs.
private struct ImportLabel: View {
    var title: String
    var detail: String?
    var systemImage: String

    init(_ title: String, detail: String? = nil, systemImage: String) {
        self.title = title
        self.detail = detail
        self.systemImage = systemImage
    }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                if let detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        } icon: {
            Image(systemName: systemImage)
        }
    }
}

#Preview {
    Text("Rides").sheet(isPresented: .constant(true)) {
        TrackRouteSheet(library: .sample)
    }
}

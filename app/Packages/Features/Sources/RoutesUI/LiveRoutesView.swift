import SwiftUI
import Models
import Services

/// The Routes tab on live data: the saved routes, shortlist and ride history from the Ride On
/// API. Adding or removing a shortlisted route saves straight away with `PUT /route-selection`,
/// then the board Rides ranks is refreshed so the shortlist cards show where each route stands.
public struct LiveRoutesView: View {
    private enum Phase { case loading, signedOut, failed(String), loaded }

    @State private var phase = Phase.loading
    @State private var library = RouteLibrary(routes: [], shortlist: [], rides: [])
    /// The shortlist as the API last confirmed it; edits save over it.
    @State private var saved: RouteLibraryLoader.Shortlist?
    @State private var saving = false
    @State private var saveError: String?
    /// Holds the board Rides loaded, which gives the shortlist cards their status.
    @Environment(RideBoardStore.self) private var rides

    public init() {}

    public var body: some View {
        content
            .navigationTitle("Routes")
            // Loads again on every return to the tab, picking up routes imported elsewhere.
            .task { await load() }
            .onChange(of: library.shortlist) { Task { await save() } }
            .alert("Couldn't Save Your Shortlist", isPresented: Binding { saveError != nil } set: { if !$0 { saveError = nil } }) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(saveError ?? "")
            }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
        case .signedOut:
            ContentUnavailableView("Sign In to See Your Routes", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
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
            RoutesView(library: $library, board: rides.board)
        }
    }

    private var isLoaded: Bool {
        if case .loaded = phase { true } else { false }
    }

    private func load() async {
        guard RideOnAPI.isSignedIn else { phase = .signedOut; return }
        let rides = rides
        async let board: Void = rides.refresh()
        do {
            let (loaded, shortlist) = try await RouteLibraryLoader.load()
            if saving || saved.map({ library.shortlist != $0.routeIDs }) == true {
                // A shortlist edit is still saving; it reconciles with the API's list itself.
                library.routes = loaded.routes
                library.rides = loaded.rides
            } else {
                library = loaded
                saved = shortlist
            }
            phase = .loaded
        } catch let failure as RideOnAPI.Failure where failure.status == 401 {
            phase = .signedOut
        } catch where Task.isCancelled {
            // The tab went away mid-load (URLSession throws URLError.cancelled, not
            // CancellationError); it loads again on return.
        } catch {
            // A reload that fails keeps the routes already showing.
            if !isLoaded { phase = .failed(error.localizedDescription) }
        }
        await board
    }

    /// Saves the shortlist until it matches what the API has, folding in edits made while a save
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
            // A route was deleted since the library loaded.
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
        await rides.refresh(force: true)
    }
}

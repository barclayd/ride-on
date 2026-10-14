import SwiftUI
import AuthenticationServices
import Models
import Services

/// The Rides tab on live data: the shortlist's recommendations from the Ride On API, behind
/// Apple or Google sign-in (docs/authentication.md, "iOS and macOS app").
public struct LiveRidesView: View {
    private enum Phase { case loading, signedOut, empty, failed(String), loaded(RideBoard) }

    @State private var phase = Phase.loading
    @State private var signInError: String?
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    public init() {}

    public var body: some View {
        content
            .navigationTitle("Rides")
            .task { await load() }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView()
        case .signedOut:
            ContentUnavailableView {
                Label("Sign In to Ride On", systemImage: "bicycle")
            } description: {
                Text(signInError ?? "Your shortlisted routes and their best rides come from your Ride On account.")
            } actions: {
                Button("Sign in with Apple", systemImage: "apple.logo") { Task { await signIn(.apple) } }
                    .buttonStyle(.borderedProminent)
                Button("Sign in with Google") { Task { await signIn(.google) } }
            }
        case .empty:
            ContentUnavailableView("No Routes Shortlisted", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                   description: Text("Choose routes with the Ride On extension on cycle.travel and they'll appear here."))
                .refreshable { await load() }
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Rides", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") { Task { await load() } }
            }
        case .loaded(let board) where board.picks.isEmpty:
            ContentUnavailableView("No Rides in Your Window", systemImage: "calendar.badge.exclamationmark",
                                   description: Text("None of your shortlisted routes fit the days you've chosen."))
        case .loaded(let board):
            RidesView(board: board, refresh: load)
        }
    }

    private func load() async {
        guard RideOnAPI.isSignedIn else { phase = .signedOut; return }
        do {
            phase = try await RideBoardLoader.load().map(Phase.loaded) ?? .empty
        } catch let failure as RideOnAPI.Failure where failure.status == 401 {
            phase = .signedOut
        } catch is CancellationError {
            // The view went away mid-load; leave the phase as it was.
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func signIn(_ provider: RideOnAPI.Provider) async {
        do {
            let flow = try await RideOnAPI.startSignIn(provider)
            let callback = try await webAuthenticationSession.authenticate(
                using: flow.url,
                callback: .https(host: RideOnAPI.host, path: RideOnAPI.signInDonePath),
                preferredBrowserSession: nil,
                additionalHeaderFields: [:])
            try await RideOnAPI.finishSignIn(callback: callback, flow: flow)
            signInError = nil
            phase = .loading
            await load()
        } catch ASWebAuthenticationSessionError.canceledLogin {
            // The person closed the sheet.
        } catch {
            signInError = error.localizedDescription
        }
    }
}

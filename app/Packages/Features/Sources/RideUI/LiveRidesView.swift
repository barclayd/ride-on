import SwiftUI
import AuthenticationServices
import Models
import Services
import DesignSystem

/// The Rides tab on live data: the shortlist's recommendations from the Ride On API, behind
/// Apple or Google sign-in (docs/authentication.md, "iOS and macOS app").
public struct LiveRidesView: View {
    @Environment(RideBoardStore.self) private var rides
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var signInError: String?
    @State private var choosingWindow = false
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    /// Saved Preferences changes move `revision` on, and Rides re-ranks.
    @Environment(RiderSettingsStore.self) private var settings: RiderSettingsStore?
    @Environment(RideTracker.self) private var tracker: RideTracker?

    public init() {}

    public var body: some View {
        content
            .navigationTitle("Rides")
            .task { await refresh() }
            .animation(reduceMotion ? nil : Motion.panelMaterialize, value: rides.hasLoaded)
    }

    @ViewBuilder private var content: some View {
        if !rides.isSignedIn {
            ContentUnavailableView {
                Label("Sign In to Ride On", systemImage: "bicycle")
            } description: {
                Text(signInError ?? "Your shortlisted routes and their best rides come from your Ride On account.")
            } actions: {
                Button("Sign in with Apple", systemImage: "apple.logo") { Task { await signIn(.apple) } }
                    .buttonStyle(.borderedProminent)
                Button("Sign in with Google") { Task { await signIn(.google) } }
            }
        } else if let board = rides.board {
            if board.expired || board.window.end <= .now || board.picks.isEmpty {
                ContentUnavailableView {
                    Label(board.expired || board.window.end <= .now ? "Your Window Has Passed" : "No Rides in Your Window", systemImage: "calendar.badge.exclamationmark")
                } description: {
                    Text(rides.status ?? "Choose dates to see your next rides.")
                } actions: {
                    Button("Choose Dates") { choosingWindow = true }
                        .buttonStyle(.borderedProminent)
                    Button("Refresh") { Task { await refresh(force: true) } }
                }
                .sheet(isPresented: $choosingWindow) { RideWindowSheet(board: board) { await refresh(force: true, window: $0) } }
            } else {
                RidesView(board: board, refresh: { await refresh(force: true) },
                          apply: { await refresh(force: true, window: $0) },
                          refreshStatus: rides.status, previousPlan: rides.isPreviousPlan(at: .now))
            }
        } else if rides.hasLoaded {
            ScrollView {
                ContentUnavailableView("No Routes Shortlisted", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                       description: Text(rides.status ?? "Choose routes with the Ride On extension on cycle.travel and they'll appear here."))
            }
            .refreshable { await refresh(force: true) }
        } else if let message = rides.refreshError {
            ContentUnavailableView {
                Label("Couldn't Load Rides", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") { Task { await refresh(force: true) } }
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Rectangle().fill(.quaternary).frame(height: 280)
                    Text("Your next ride").font(.title.bold()).redacted(reason: .placeholder)
                    ProgressView("Loading your rides…")
                    Text("Your Window").font(.title3.bold())
                    RoundedRectangle(cornerRadius: 26).fill(.quaternary).frame(height: 140)
                }
                .padding(16)
            }
        }
    }

    private func refresh(force: Bool = false, window: RideWindow? = nil) async {
        let tracker = tracker
        async let tracked: Void? = tracker?.load()
        await rides.refresh(force: force, window: window)
        _ = await tracked
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
            await refresh()
            await settings?.load()
        } catch ASWebAuthenticationSessionError.canceledLogin {
            // The person closed the sheet.
        } catch {
            signInError = error.localizedDescription
        }
    }
}

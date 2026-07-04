import SwiftUI
import Models
import DesignSystem
import SharedUI

/// Step 6 — Strava connect, early enough to prefill step 7's speeds
/// (decision record: "Strava/Health early for prefill"). Wired against
/// `StravaClientProtocol` only (fixture in sim/tests; real OAuth is Phase 6).
struct StravaConnectStep: View {
    var isConnected: Bool
    var isConnecting: Bool
    var pageIndex: Int
    var pageCount: Int
    var onConnect: () -> Void
    var onContinue: () -> Void

    var body: some View {
        DialScreen(
            title: "Connect Strava",
            bodyText: "Link Strava to sync your routes and prefill your riding speeds from your recent activity.",
            sky: isConnected ? .sunny : .overcast,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            if isConnecting {
                ProgressView().tint(.white)
            } else {
                Button(isConnected ? "Connected" : "Connect Strava", action: onConnect)
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .disabled(isConnected)
            }
        } onContinue: { onContinue() }
    }
}

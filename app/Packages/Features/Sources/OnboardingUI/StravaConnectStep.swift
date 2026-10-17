import SwiftUI
import Models
import DesignSystem
import SharedUI
import Services

/// Step 6 introduces the account connection in Preferences. The legacy connect
/// action is retained only for the deterministic onboarding fixture.
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
            bodyText: "See your completed cycling activities in Ride On. After setup, sign in and open Preferences → Strava to connect.",
            sky: isConnected ? .sunny : .overcast,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            if !FixtureWorld.isEnabled {
                Text("You can connect at any time from Preferences.").foregroundStyle(.secondary)
            } else if isConnecting {
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

import SwiftUI
import DesignSystem
import SharedUI

/// Step 0 — the "feature-splash welcome" (DESIGN-SYSTEM.md §9: "splash
/// screen = UIOnboarding feature-splash pattern"). The only non-skippable
/// step. Reuses `DialScreen`'s scaffold with a feature list standing in for
/// the "one control".
struct WelcomeStep: View {
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void

    var body: some View {
        DialScreen(
            title: "Ride On",
            bodyText: "Ride On tells you which of your routes to ride today — scored against real weather, your time, and your preferences.",
            sky: .sunny,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            VStack(alignment: .leading, spacing: 20) {
                FeatureRow(symbol: "cloud.sun.fill", text: "Scored against real weather, not a guess")
                FeatureRow(symbol: "clock.fill", text: "Fits the time you actually have today")
                FeatureRow(symbol: "figure.outdoor.cycle", text: "Import from Strava, GPX, or your own rides")
            }
        } onContinue: { onContinue() }
    }
}

private struct FeatureRow: View {
    var symbol: String
    var text: String

    var body: some View {
        Label {
            Text(text).font(.body)
        } icon: {
            Image(systemName: symbol)
                .frame(width: 28)
        }
        .foregroundStyle(.white)
    }
}

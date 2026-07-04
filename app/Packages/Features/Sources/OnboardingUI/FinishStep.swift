import SwiftUI
import DesignSystem
import SharedUI

/// Step 8 — the last step. `onContinue` flips
/// `PreferencesStore.hasCompletedOnboarding`, which reactively swaps the app
/// root over to `RootView` (Today), no relaunch needed.
struct FinishStep: View {
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void
    @ScaledMetric(relativeTo: .largeTitle) private var symbolSize: CGFloat = 56

    var body: some View {
        DialScreen(
            title: "You're All Set",
            bodyText: "Ride On will start recommending routes based on today's weather and your preferences.",
            sky: .sunny,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: symbolSize))
                .foregroundStyle(.white)
        } onContinue: { onContinue() }
    }
}

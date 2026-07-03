import SwiftUI

/// Placeholder for the card-stack screen (DESIGN-SYSTEM.md §6 `RideCard`,
/// Phase 4). Just enough structure for the E2E smoke test to find a card.
struct TodayView: View {
    var body: some View {
        VStack {
            Text(FixtureWorld.sampleRoute.name)
                .font(.title2.bold())
                .accessibilityIdentifier("today-placeholder-card")
        }
        .navigationTitle("Today")
    }
}

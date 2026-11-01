import SwiftUI
import Domain
import DesignSystem
import SharedUI

/// Step 7 — read-only review of the speeds step 6 just prefilled (or the
/// `RiderPreferences` defaults, if Strava isn't connected). Editable later in
/// Preferences → Riding — this is a preview, not a
/// second editor.
struct SpeedPrefillStep: View {
    @Environment(\.speedSystem) private var speedSystem
    var speedKphBySurface: [SurfaceType: Double]
    var isStravaConnected: Bool
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void

    private static let order: [SurfaceType] = [.paved, .busyRoad, .unpaved, .path]

    var body: some View {
        DialScreen(
            title: "Your Speeds",
            bodyText: isStravaConnected
                ? "Prefilled from your Strava activity. Fine-tune anytime in Preferences."
                : "Sensible defaults for now. Fine-tune anytime in Preferences.",
            sky: .overcast,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            VStack(spacing: 8) {
                ForEach(Self.order, id: \.self) { surface in
                    HStack {
                        Text(label(for: surface))
                        Spacer()
                        Text(UnitFormat.speed(kph: speedKphBySurface[surface] ?? 20, system: speedSystem))
                            .monospacedDigit()
                    }
                    .foregroundStyle(.white)
                }
            }
            .padding()
            // Real material, not white paint — respects Reduce Transparency
            // and picks up the ambiance gradient behind it (DESIGN-SYSTEM §2).
            .background(.ultraThinMaterial, in: .rect(cornerRadius: CornerRadius.panel))
        } onContinue: { onContinue() }
    }

    private func label(for surface: SurfaceType) -> String {
        switch surface {
        case .paved: "Paved"
        case .busyRoad: "Busy Road"
        case .unpaved: "Unpaved"
        case .path: "Path"
        case .unknown: "Unknown"
        }
    }
}

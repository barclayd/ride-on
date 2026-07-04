import SwiftUI
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 8: compact 0–100 ride-score indicator used
/// on list rows and the breakdown header. A thin wrapper around the stock
/// `Gauge`/`.accessoryCircularCapacity` style (Apple's ready-made ring) —
/// "stock components first" per §1.2 — that fixes the score band -> tint
/// mapping and typesets the number per §4 (monospaced digits).
public struct ScoreRing: View {
    public var score: Double // 0...1, same domain as `RankedRide.score`.
    public var size: CGFloat

    public init(score: Double, size: CGFloat = 44) {
        self.score = score
        self.size = size
    }

    private var percent: Int { Int((score * 100).rounded()) }

    public var body: some View {
        Gauge(value: score, in: 0...1) {
            EmptyView()
        } currentValueLabel: {
            Text(percent, format: .number)
                .font(.caption.bold().monospacedDigit())
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(ConditionPalette.color(forScore: score))
        .frame(width: size, height: size)
        .accessibilityLabel("Score \(percent) out of 100")
    }
}

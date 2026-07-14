import SwiftUI
import Engine
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 8: compact tier ring used on list rows and
/// the breakdown header. A thin wrapper around the stock
/// `Gauge`/`.accessoryCircularCapacity` style (Apple's ready-made ring) —
/// "stock components first" per §1.2. The gauge fill is the raw 0–1 score;
/// the center shows the `RideTier` letter (S/A/B/C/D), the user-facing
/// grade for how the conditions match the ride.
public struct ScoreRing: View {
    public var score: Double // 0...1, same domain as `RankedRide.score`.
    public var size: CGFloat

    public init(score: Double, size: CGFloat = 44) {
        self.score = score
        self.size = size
    }

    private var tier: RideTier { RideTier(score: score) }

    public var body: some View {
        Gauge(value: score, in: 0...1) {
            EmptyView()
        } currentValueLabel: {
            Text(tier.letter)
                .font(.system(.body, design: .rounded).bold())
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(ConditionPalette.color(forScore: score))
        .frame(width: size, height: size)
        .accessibilityLabel("Rated \(tier.letter). \(tier.summary).")
    }
}

#Preview("Tier bands") {
    HStack(spacing: 16) {
        ScoreRing(score: 0.9)
        ScoreRing(score: 0.75)
        ScoreRing(score: 0.6)
        ScoreRing(score: 0.45)
        ScoreRing(score: 0.2)
    }
    .padding()
}

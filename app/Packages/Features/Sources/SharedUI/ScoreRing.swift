import SwiftUI
import Engine
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 8: compact tier ring used on list rows and
/// the breakdown header. Hand-drawn (two stroked `Circle`s) rather than the
/// stock `Gauge`/`.accessoryCircularCapacity` — the accessory gauge styles
/// render at a fixed intrinsic size and ignore `.frame`, so `size` was a
/// no-op and every ring drew at the same (oversized) diameter. The ring
/// fill is the raw 0–1 score; the center shows the `RideTier` letter
/// (S/A/B/C/D), the user-facing grade for how the conditions match the ride.
public struct ScoreRing: View {
    public var score: Double // 0...1, same domain as `RankedRide.score`.
    public var size: CGFloat

    public init(score: Double, size: CGFloat = 44) {
        self.score = score
        self.size = size
    }

    // Fill animates 0 -> score on appear (Motion.ringFill); tint and letter
    // stay keyed to the final score so the color doesn't ramp through the
    // palette while filling.
    @State private var fill: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var tier: RideTier { RideTier(score: score) }

    private var lineWidth: CGFloat { max(3, size * 0.09) }

    public var body: some View {
        ZStack {
            Circle()
                .stroke(.quaternary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fill)
                .stroke(
                    ConditionPalette.color(forScore: score),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            Text(tier.letter)
                .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
        }
        .padding(lineWidth / 2) // stroke straddles the path — keep it inside the frame
        .frame(width: size, height: size)
        .accessibilityLabel("Rated \(tier.letter). \(tier.summary).")
        .onAppear {
            withAnimation(reduceMotion ? nil : Motion.ringFill) { fill = score }
        }
        .onChange(of: score) { _, newScore in
            withAnimation(reduceMotion ? nil : Motion.ringFill) { fill = newScore }
        }
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

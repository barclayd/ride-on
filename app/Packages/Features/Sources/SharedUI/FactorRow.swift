import SwiftUI
import Engine
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 3: one scored factor in the breakdown
/// sheet — symbol, name, dual-layer range bar (Apple Weather's 10-day bar
/// pattern: a grey track plus a colored dot for today's value), 0–1 score as
/// text. Tap expands the explanation.
public struct FactorRow: View {
    public var score: FactorScore
    @State private var isExpanded = false

    public init(score: FactorScore) {
        self.score = score
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(score.factor.displayName, systemImage: score.factor.symbolName)
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(score.value, format: .number.precision(.fractionLength(2)))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("score \(Int((score.value * 100).rounded())) out of 100")
            }
            RangeBar(value: score.value)
            if isExpanded {
                Text(score.reason)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(Motion.glassTapLayout) { isExpanded.toggle() }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Double tap for details")
    }
}

/// Not a §6 component on its own — the range-bar visual inside `FactorRow`.
/// The grey track is "your preference range" (0...1, the full scorable
/// span); the colored dot is "today's value" at `value`'s position.
private struct RangeBar: View {
    var value: Double

    var body: some View {
        GeometryReader { geometry in
            let dotDiameter: CGFloat = 12
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.secondary.opacity(0.25))
                    .frame(height: 6)
                Circle()
                    .fill(color)
                    .frame(width: dotDiameter, height: dotDiameter)
                    .offset(x: max(0, min(geometry.size.width - dotDiameter, geometry.size.width * value - dotDiameter / 2)))
            }
        }
        .frame(height: 12)
    }

    private var color: Color {
        switch value {
        case 0.7...: .green
        case 0.4..<0.7: .yellow
        default: .red
        }
    }
}

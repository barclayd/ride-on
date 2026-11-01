import SwiftUI

/// DESIGN-SYSTEM.md §6 component 7: the score as a ring with the number inside (Ride detail,
/// widgets). A `Gauge` with a ring style; scales with Dynamic Type.
public struct ScoreGauge: View {
    var score: Int
    var tint: Color
    @ScaledMetric(relativeTo: .title2) private var size = 64

    /// `size` is the ring's width at the default text size; it scales with Dynamic Type.
    public init(score: Int, tint: Color = .accentColor, size: CGFloat = 64) {
        self.score = score
        self.tint = tint
        _size = ScaledMetric(wrappedValue: size, relativeTo: .title2)
    }

    public var body: some View {
        Gauge(value: Double(score), in: 0...100) {
            Text("Score")
        } currentValueLabel: {
            Text(score, format: .number)
        }
        .gaugeStyle(Ring(tint: tint, lineWidth: size / 10, fontSize: size * 0.34))
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Score")
        .accessibilityValue("\(score) out of 100")
    }
}

private struct Ring: GaugeStyle {
    var tint: Color
    var lineWidth: CGFloat
    var fontSize: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        ZStack {
            Circle().stroke(.fill.tertiary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: configuration.value)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            configuration.currentValueLabel
                .font(.system(size: fontSize, weight: .bold))
                .monospacedDigit()
        }
        .padding(lineWidth / 2)
    }
}

#Preview {
    ScoreGauge(score: 86)
}

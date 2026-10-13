import SwiftUI

/// DESIGN-SYSTEM.md §6 component 7: the score as a ring with the number inside (Ride detail,
/// widgets). A `Gauge` with a ring style; scales with Dynamic Type.
public struct ScoreGauge: View {
    var score: Int
    var tint: Color
    @ScaledMetric(relativeTo: .title2) private var size = 64

    public init(score: Int, tint: Color = .accentColor) {
        self.score = score
        self.tint = tint
    }

    public var body: some View {
        Gauge(value: Double(score), in: 0...100) {
            Text("Score")
        } currentValueLabel: {
            Text(score, format: .number)
        }
        .gaugeStyle(Ring(tint: tint, lineWidth: size / 10))
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Score")
        .accessibilityValue("\(score) out of 100")
    }
}

private struct Ring: GaugeStyle {
    var tint: Color
    var lineWidth: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        ZStack {
            Circle().stroke(.fill.tertiary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: configuration.value)
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            configuration.currentValueLabel
                .font(.title2.bold())
                .monospacedDigit()
        }
        .padding(lineWidth / 2)
    }
}

#Preview {
    ScoreGauge(score: 86)
}

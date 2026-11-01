import SwiftUI
import Domain

/// DESIGN-SYSTEM.md §6.9: Comfortable Wind's polar shape. You ride up the page; the shaded
/// shape reaches the headwind limit ahead, the crosswind limit each side and any tailwind
/// behind, and the dashed ring is the gust limit. Values are km/h; labels follow `speedSystem`.
/// Drawn, so VoiceOver gets one summary and the Sliders below it are the way to edit.
public struct WindEnvelope: View {
    var headwindKph: Double
    var crosswindKph: Double
    var gustKph: Double?
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.locale) private var locale

    public init(headwindKph: Double, crosswindKph: Double, gustKph: Double?) {
        self.headwindKph = headwindKph
        self.crosswindKph = crosswindKph
        self.gustKph = gustKph
    }

    public var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            // Room above and below for the Headwind and Tailwind labels: Canvas clips to its bounds.
            let radius = min(size.width / 2, size.height / 2 - 22) - 4
            // The gust ring sits at the edge; without one, the chart still leaves room for 40 km/h.
            let scale = radius / max(gustKph ?? 45, headwindKph * 1.15, crosswindKph * 1.15, 40)
            func at(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: center.x + x, y: center.y + y) }

            for kph in stride(from: 10.0, to: radius / scale, by: 10) {
                context.stroke(Path(ellipseIn: CGRect(origin: at(-kph * scale, -kph * scale), size: CGSize(width: 2 * kph * scale, height: 2 * kph * scale))),
                               with: .style(.quaternary), lineWidth: 1)
            }
            var cross = Path()
            cross.move(to: at(0, -radius)); cross.addLine(to: at(0, radius))
            cross.move(to: at(-radius, 0)); cross.addLine(to: at(radius, 0))
            context.stroke(cross, with: .style(.quaternary), lineWidth: 1)

            let h = headwindKph * scale, c = crosswindKph * scale, tail = radius * 0.92
            var envelope = Path()
            envelope.move(to: at(-c, 0))
            envelope.addCurve(to: at(0, -h), control1: at(-c, -h * 0.6), control2: at(-c * 0.55, -h))
            envelope.addCurve(to: at(c, 0), control1: at(c * 0.55, -h), control2: at(c, -h * 0.6))
            envelope.addCurve(to: at(0, tail), control1: at(c, tail * 0.6), control2: at(c * 0.45, tail))
            envelope.addCurve(to: at(-c, 0), control1: at(-c * 0.45, tail), control2: at(-c, tail * 0.6))
            context.fill(envelope, with: .color(.accentColor.opacity(0.12)))
            context.stroke(envelope, with: .color(.accentColor), lineWidth: 2.5)

            for point in [at(0, -h), at(-c, 0), at(c, 0)] {
                let dot = Path(ellipseIn: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10))
                context.fill(dot, with: .color(.white))
                context.stroke(dot, with: .color(.accentColor), lineWidth: 2)
            }
            context.draw(Image(systemName: "arrow.up"), at: center)

            if let gustKph {
                let ring = Path(ellipseIn: CGRect(x: center.x - gustKph * scale, y: center.y - gustKph * scale, width: 2 * gustKph * scale, height: 2 * gustKph * scale))
                context.stroke(ring, with: .color(.blue), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                context.draw(Text("Gusts \(number(gustKph))").font(.footnote).foregroundStyle(.blue),
                             at: at(gustKph * scale * 0.72, -gustKph * scale * 0.8), anchor: .bottomLeading)
            }
            context.draw(Text("Headwind \(number(headwindKph))").font(.footnote.weight(.semibold)), at: at(0, -radius - 6), anchor: .bottom)
            context.draw(Text(number(crosswindKph)).font(.footnote.weight(.semibold)), at: at(-c - 8, -6), anchor: .bottomTrailing)
            context.draw(Text(number(crosswindKph)).font(.footnote.weight(.semibold)), at: at(c + 8, -6), anchor: .bottomLeading)
            context.draw(Text("Tailwind, any").font(.footnote.weight(.semibold)).foregroundStyle(.secondary), at: at(0, radius + 8), anchor: .top)
        }
        .accessibilityElement()
        .accessibilityLabel("Comfortable wind")
        .accessibilityValue(summary)
    }

    /// The bare number in display units: "15".
    private func number(_ kph: Double) -> String {
        (speedSystem == .metric ? kph : kph / 1.609344).formatted(.number.precision(.fractionLength(0)).locale(locale))
    }

    private var summary: String {
        let speed = { UnitFormat.speed(kph: $0, system: speedSystem, locale: locale) }
        return ["Headwind up to \(speed(headwindKph))", "crosswind up to \(speed(crosswindKph))", "any tailwind",
                gustKph.map { "gusts up to \(speed($0))" } ?? "no gust limit"].joined(separator: ", ")
    }
}

#Preview {
    Form {
        WindEnvelope(headwindKph: 15, crosswindKph: 20, gustKph: 45).frame(height: 320)
    }
}

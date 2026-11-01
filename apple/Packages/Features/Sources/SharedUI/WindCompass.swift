import SwiftUI
import DesignSystem

/// §6: Weather's wind dial. Ticks round the edge, the four points, an arrow the way the wind
/// blows and the speed in the middle. No arrow when the wind is too light to have a direction.
public struct WindCompass: View {
    var towardsDegrees: Double?
    var speed: String
    var unit: String
    @ScaledMetric(relativeTo: .body) private var diameter = 104.0

    /// `towardsDegrees` is where the wind blows to, clockwise from north; `speed` is the number alone.
    public init(towardsDegrees: Double?, speed: String, unit: String) {
        self.towardsDegrees = towardsDegrees
        self.speed = speed
        self.unit = unit
    }

    public var body: some View {
        let size = min(diameter, 160)
        let radius = size / 2
        ZStack {
            Canvas { context, canvas in
                let centre = CGPoint(x: canvas.width / 2, y: canvas.height / 2)
                for tick in 0..<72 {
                    let major = tick % 18 == 0
                    let angle = Angle.degrees(Double(tick) * 5)
                    var path = Path()
                    path.move(to: point(centre, radius - (major ? 9 : 5), angle))
                    path.addLine(to: point(centre, radius - 1, angle))
                    context.stroke(path, with: .color(.secondary.opacity(major ? 0.9 : 0.45)), lineWidth: major ? 1.5 : 1)
                }
                guard let towardsDegrees else { return }
                var arrow = context
                arrow.translateBy(x: centre.x, y: centre.y)
                arrow.rotate(by: .degrees(towardsDegrees))
                let reach = radius - 13
                var shaft = Path()
                shaft.move(to: CGPoint(x: 0, y: reach - 3))
                shaft.addLine(to: CGPoint(x: 0, y: -reach + 8))
                arrow.stroke(shaft, with: .foreground, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                var head = Path()
                head.move(to: CGPoint(x: 0, y: -reach))
                head.addLine(to: CGPoint(x: -5, y: -reach + 9))
                head.addLine(to: CGPoint(x: 5, y: -reach + 9))
                head.closeSubpath()
                arrow.fill(head, with: .foreground)
                arrow.stroke(Path(ellipseIn: CGRect(x: -3, y: reach - 3, width: 6, height: 6)), with: .foreground, lineWidth: 1.5)
            }
            ForEach(["N", "E", "S", "W"].indices, id: \.self) { i in
                Text(["N", "E", "S", "W"][i])
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(i == 0 ? .primary : .secondary)
                    .offset(point(.zero, radius - 18, .degrees(Double(i) * 90)).size)
            }
            VStack(spacing: -2) {
                Text(speed).font(.title3.bold())
                Text(unit).font(.caption2).foregroundStyle(.secondary)
            }
            .monospacedDigit()
            .frame(width: radius * 0.9, height: radius * 0.9)
            .background(.cardBackground, in: .circle)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func point(_ centre: CGPoint, _ radius: Double, _ angle: Angle) -> CGPoint {
        CGPoint(x: centre.x + radius * sin(angle.radians), y: centre.y - radius * cos(angle.radians))
    }
}

private extension CGPoint {
    var size: CGSize { CGSize(width: x, height: y) }
}

#Preview {
    HStack(spacing: 24) {
        WindCompass(towardsDegrees: 60, speed: "13", unit: "mph")
        WindCompass(towardsDegrees: nil, speed: "5", unit: "km/h")
    }
    .padding()
}

import SwiftUI
import Domain

/// §6: shares of a whole in order, each in its own colour, like the bar in Settings › iPhone
/// Storage. A segment's optional label sits above where it starts.
public struct ShareBar: View {
    public struct Segment: Hashable {
        public var share: Double
        public var color: Color
        public var label: String?

        public init(share: Double, color: Color, label: String? = nil) {
            self.share = share
            self.color = color
            self.label = label
        }
    }

    var segments: [Segment]
    @ScaledMetric(relativeTo: .body) private var height = 16.0
    private let gap = 2.0

    public init(_ segments: [Segment]) {
        self.segments = segments.filter { $0.share > 0 }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if segments.contains(where: { $0.label != nil }) {
                Proportional(shares: segments.map(\.share), gap: gap) {
                    ForEach(segments.indices, id: \.self) { i in
                        Text(segments[i].label ?? "")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                }
            }
            Proportional(shares: segments.map(\.share), gap: gap) {
                ForEach(segments.indices, id: \.self) { i in
                    Rectangle().fill(segments[i].color)
                }
            }
            .frame(height: height)
            .clipShape(.rect(cornerRadius: height / 3, style: .continuous))
        }
        .accessibilityHidden(true)
    }
}

/// Lays its subviews left to right, each as wide as its share of the whole, `gap` apart.
private struct Proportional: Layout {
    var shares: [Double]
    var gap: Double

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let height = proposal.height ?? subviews.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
        return CGSize(width: proposal.replacingUnspecifiedDimensions().width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let total = max(shares.reduce(0, +), .ulpOfOne)
        let room = max(0, bounds.width - gap * Double(subviews.count - 1))
        var x = bounds.minX
        for (subview, share) in zip(subviews, shares) {
            let width = room * share / total
            subview.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: width, height: bounds.height))
            x += width + gap
        }
    }
}

public extension RideDetail.SkyBreakdown.Kind {
    var tint: Color {
        switch self {
        case .sunny: .yellow
        case .sunnyIntervals: .yellow.opacity(0.5)
        case .cloud: .gray
        case .unknown: .gray.opacity(0.15)
        }
    }
}

public extension RideDetail.WindBreakdown.Effect {
    /// RouteProfile's wind colours, with grey for light wind.
    var tint: Color {
        switch self {
        case .tailwind: .accentColor
        case .crosswind: .orange
        case .headwind: .red
        case .light: .gray
        }
    }
}

#Preview {
    ShareBar([
        .init(share: 0.45, color: .orange, label: "SW"),
        .init(share: 0.35, color: .accentColor),
        .init(share: 0.2, color: .red, label: "W"),
    ])
    .padding()
}

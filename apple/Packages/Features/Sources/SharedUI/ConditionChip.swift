import SwiftUI
import Domain

/// DESIGN-SYSTEM.md §6 component 2: an SF Symbol and a value in `.footnote` on a solid
/// `.fill.tertiary` capsule ("9–14°", "15 km/h tailwind"). Cards wrap them in a `FlowLayout`,
/// at most four.
public struct ConditionChip: View {
    var text: String
    var systemImage: String?
    var tint: Color

    public init(_ text: String, systemImage: String? = nil, tint: Color = .secondary) {
        self.text = text
        self.systemImage = systemImage
        self.tint = tint
    }

    public var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage)
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
            }
            Text(text)
        }
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.fill.tertiary, in: .capsule)
    }
}

/// Left-to-right wrapping layout, so chips flow onto a second row at large Dynamic Type sizes
/// instead of overflowing the card (DESIGN-SYSTEM.md §8).
public struct FlowLayout: Layout {
    var spacing: CGFloat

    public init(spacing: CGFloat = 6) {
        self.spacing = spacing
    }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map { $0.map(\.size.height).max() ?? 0 }.reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map { row in row.map(\.size.width).reduce(0, +) + spacing * CGFloat(row.count - 1) }.max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for (subview, size) in row {
                subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += (row.map(\.size.height).max() ?? 0) + spacing
        }
    }

    private func rows(width: CGFloat, subviews: Subviews) -> [[(subview: LayoutSubview, size: CGSize)]] {
        var rows: [[(subview: LayoutSubview, size: CGSize)]] = []
        var rowWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if rows.isEmpty || rowWidth + spacing + size.width > width {
                rows.append([(subview, size)])
                rowWidth = size.width
            } else {
                rows[rows.count - 1].append((subview, size))
                rowWidth += spacing + size.width
            }
        }
        return rows
    }
}

#Preview {
    FlowLayout {
        ConditionChip("9–14°", systemImage: "thermometer.medium", tint: .orange)
        ConditionChip("15 km/h tailwind", systemImage: "wind", tint: .blue)
        ConditionChip("Gusts 28 km/h")
        ConditionChip("Sunny spells", systemImage: "sun.max.fill", tint: .yellow)
    }
    .padding()
}

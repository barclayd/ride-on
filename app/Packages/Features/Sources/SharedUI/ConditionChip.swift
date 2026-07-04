import SwiftUI
import Models
import DesignSystem

/// Plain data for one chip — not itself the component, just what
/// `ConditionChip` renders. Kept separate so callers (Today card, Route
/// Detail) can build the list without importing SwiftUI-specific view code.
public struct ConditionChipData: Identifiable, Hashable {
    public var symbol: String
    public var text: String
    /// A named semantic/condition color, not a raw `Color` — chips must
    /// differ by symbol too (Differentiate Without Color, DESIGN-SYSTEM.md §3),
    /// this is just the tint.
    public var tint: Color

    public init(symbol: String, text: String, tint: Color) {
        self.symbol = symbol
        self.text = text
        self.tint = tint
    }

    public var id: String { symbol + text }
}

/// DESIGN-SYSTEM.md §6 component 2: SF Symbol + value in `.footnote`,
/// condition-palette tint, on a thin-material capsule.
public struct ConditionChip: View {
    public var data: ConditionChipData

    public init(_ data: ConditionChipData) {
        self.data = data
    }

    public var body: some View {
        Label {
            Text(data.text)
                .lineLimit(1)
        } icon: {
            Image(systemName: data.symbol)
        }
        .labelStyle(.titleAndIcon)
        .font(.footnote)
        .foregroundStyle(data.tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: .capsule)
    }
}

/// Lays out up to 4 chips (DESIGN-SYSTEM.md §6 cap). A `Layout` flow wrap,
/// not a fixed `HStack`, so oversized Dynamic Type chip text wraps to a
/// second row instead of overflowing the card edge (DESIGN-SYSTEM.md §8:
/// "chips wrap to two rows").
public struct ConditionChipRow: View {
    public var chips: [ConditionChipData]

    public init(chips: [ConditionChipData]) {
        self.chips = chips
    }

    public var body: some View {
        ChipFlowLayout(spacing: 8) {
            ForEach(chips.prefix(4)) { ConditionChip($0) }
        }
    }
}

/// Minimal left-to-right, top-to-bottom flow layout — just enough to wrap
/// chips onto a new row when they don't fit, no third-party dependency.
private struct ChipFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth + size.width > width, rowWidth > 0 {
                totalHeight += rowHeight + spacing
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + (rowWidth > 0 ? spacing : 0)
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        return CGSize(width: width.isFinite ? width : rowWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var origin = bounds.origin
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if origin.x + size.width > bounds.maxX, origin.x > bounds.minX {
                origin.x = bounds.minX
                origin.y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: origin, anchor: .topLeading, proposal: .unspecified)
            origin.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

public extension ConditionChipData {
    /// Builds the Today card's 4 chips from a route's factor scores + the
    /// day's weather/travel numbers — the "computed state drives the
    /// visuals" principle (DESIGN-SYSTEM.md §1.3): every chip reads off a
    /// real number for this route and this day, never a canned icon set.
    static func todayChips(
        windLabel: String,
        temperatureC: Double,
        sky: SkyCondition,
        travelMinutes: Int?,
        rideHours: Double
    ) -> [ConditionChipData] {
        var chips: [ConditionChipData] = []

        chips.append(ConditionChipData(symbol: "wind", text: windLabel, tint: .secondary))

        let skySymbol: String
        switch sky {
        case .sunny: skySymbol = "sun.max.fill"
        case .overcast: skySymbol = "cloud.fill"
        case .rain: skySymbol = "cloud.rain.fill"
        case .night: skySymbol = "moon.stars.fill"
        }
        chips.append(ConditionChipData(
            symbol: skySymbol,
            text: UnitFormat.temperature(c: temperatureC),
            tint: ConditionPalette.color(forTemperatureC: temperatureC)
        ))

        if let travelMinutes {
            chips.append(ConditionChipData(symbol: "location.fill", text: "\(travelMinutes)m away", tint: .secondary))
        }

        let hoursText = rideHours < 1
            ? "~\(Int((rideHours * 60).rounded()))m ride"
            : "~\(String(format: "%.1f", rideHours))h ride"
        chips.append(ConditionChipData(symbol: "clock.fill", text: hoursText, tint: .secondary))

        return chips
    }
}

#Preview {
    ConditionChipRow(chips: [
        ConditionChipData(symbol: "wind", text: "12 km/h wind", tint: .teal),
        ConditionChipData(symbol: "thermometer.medium", text: "18°", tint: .yellow),
        ConditionChipData(symbol: "sun.max", text: "Sunny", tint: .yellow),
    ])
    .padding()
    .background(.black)
}

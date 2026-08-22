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
    /// What VoiceOver speaks. Visible text drops word suffixes ("wind",
    /// "away", "ride") because the symbol carries the meaning — spoken text
    /// must keep them or "10 km/h, 15m, ~3.0h" is ambiguous.
    public var accessibilityText: String

    public init(symbol: String, text: String, tint: Color, accessibilityText: String? = nil) {
        self.symbol = symbol
        self.text = text
        self.tint = tint
        self.accessibilityText = accessibilityText ?? text
    }

    public var id: String { symbol + text }
}

/// DESIGN-SYSTEM.md §6 component 2: SF Symbol + value in `.footnote` on a
/// condition-tinted glass capsule. The tint lives on the icon and the glass
/// wash; the text stays `.primary` — palette-colored text (yellow at 18°C)
/// was unreadable over bright map imagery.
public struct ConditionChip: View {
    public var data: ConditionChipData

    public init(_ data: ConditionChipData) {
        self.data = data
    }

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    public var body: some View {
        let label = Label {
            Text(data.text)
                .lineLimit(1)
                .foregroundStyle(.primary)
        } icon: {
            Image(systemName: data.symbol)
                .foregroundStyle(data.tint)
        }
        .labelStyle(.titleAndIcon)
        .font(.footnote.weight(.medium))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(data.accessibilityText)

        // Custom glass must fall back to an opaque-ish material when
        // transparency is reduced (DESIGN-SYSTEM.md §2).
        if reduceTransparency {
            label.background(.thickMaterial, in: .capsule)
        } else {
            label.glassEffect(.regular.tint(data.tint.opacity(0.35)), in: .capsule)
        }
    }
}

/// Lays out up to 4 chips (DESIGN-SYSTEM.md §6 cap). A `Layout` flow wrap,
/// not a fixed `HStack`, so oversized Dynamic Type chip text wraps to a
/// second row instead of overflowing the card edge (DESIGN-SYSTEM.md §8:
/// "chips wrap to two rows").
public struct ConditionChipRow: View {
    public var chips: [ConditionChipData]

    /// Center the rows when the surrounding content is centered (the
    /// breakdown sheet); the hero card keeps the default leading alignment
    /// to match its leading-aligned name/stats.
    public var centered: Bool

    public init(chips: [ConditionChipData], centered: Bool = false) {
        self.chips = chips
        self.centered = centered
    }

    public var body: some View {
        ChipFlowLayout(spacing: 8, centered: centered) {
            ForEach(chips.prefix(4)) { ConditionChip($0) }
        }
    }
}

/// Minimal left-to-right, top-to-bottom flow layout — just enough to wrap
/// chips onto a new row when they don't fit, no third-party dependency.
private struct ChipFlowLayout: Layout {
    var spacing: CGFloat
    var centered: Bool = false

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
        // Two passes: group subviews into rows first so a centered row can
        // be offset by its leftover width before anything is placed.
        var rows: [[(subview: Subviews.Element, size: CGSize)]] = [[]]
        var rowWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth + size.width > bounds.width, rowWidth > 0 {
                rows.append([])
                rowWidth = 0
            }
            rows[rows.count - 1].append((subview, size))
            rowWidth += size.width + (rowWidth > 0 ? spacing : 0)
        }

        var y = bounds.minY
        for row in rows where !row.isEmpty {
            let contentWidth = row.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(row.count - 1)
            var x = centered ? bounds.minX + max(0, (bounds.width - contentWidth) / 2) : bounds.minX
            let rowHeight = row.map(\.size.height).max() ?? 0
            for (subview, size) in row {
                subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: .unspecified)
                x += size.width + spacing
            }
            y += rowHeight + spacing
        }
    }
}

public extension SkyCondition {
    /// The one sky -> SF Symbol mapping, shared by chips and the ranked-row
    /// weather glyph so they can never disagree.
    var systemImageName: String {
        switch self {
        case .sunny: "sun.max.fill"
        case .overcast: "cloud.fill"
        case .rain: "cloud.rain.fill"
        case .night: "moon.stars.fill"
        }
    }
}

public extension ConditionChipData {
    /// Builds the Ride card's 4 chips from a route's factor scores + the
    /// day's weather/travel numbers — the "computed state drives the
    /// visuals" principle (DESIGN-SYSTEM.md §1.3): every chip reads off a
    /// real number for this route and this day, never a canned icon set.
    /// When the best-window scan picked a start (`windowText`), the clock
    /// chip shows the window instead of the bare duration — same slot, so
    /// the §6 four-chip cap holds.
    static func rideChips(
        windLabel: String,
        temperatureC: Double,
        sky: SkyCondition,
        travelMinutes: Int?,
        rideHours: Double,
        windowText: String? = nil
    ) -> [ConditionChipData] {
        var chips: [ConditionChipData] = []

        chips.append(ConditionChipData(
            symbol: "wind",
            text: windLabel,
            tint: .secondary,
            accessibilityText: "\(windLabel) wind"
        ))

        chips.append(ConditionChipData(
            symbol: sky.systemImageName,
            text: UnitFormat.temperature(c: temperatureC),
            tint: ConditionPalette.color(forTemperatureC: temperatureC)
        ))

        if let travelMinutes {
            chips.append(ConditionChipData(
                symbol: "location.fill",
                text: "\(travelMinutes)m",
                tint: .secondary,
                accessibilityText: "\(travelMinutes) minutes away"
            ))
        }

        // No word suffixes ("wind"/"away"/"ride") — the SF Symbols carry the
        // meaning, and short labels let all four chips fit one row.
        let hoursText = rideHours < 1
            ? "~\(Int((rideHours * 60).rounded()))m"
            : "~\(rideHours.formatted(.number.precision(.fractionLength(0...1))))h"
        chips.append(ConditionChipData(
            symbol: "clock.fill",
            text: windowText ?? hoursText,
            tint: .secondary,
            accessibilityText: windowText.map { "riding window \($0)" } ?? "\(hoursText) ride"
        ))

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

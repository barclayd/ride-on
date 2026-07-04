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

/// Lays out up to 4 chips (DESIGN-SYSTEM.md §6 cap) in a row.
public struct ConditionChipRow: View {
    public var chips: [ConditionChipData]

    public init(chips: [ConditionChipData]) {
        self.chips = chips
    }

    public var body: some View {
        HStack(spacing: 8) {
            ForEach(chips.prefix(4)) { ConditionChip($0) }
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
            text: "\(Int(temperatureC.rounded()))°C",
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

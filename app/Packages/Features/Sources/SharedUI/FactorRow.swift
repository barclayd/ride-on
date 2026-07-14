import SwiftUI
import Engine
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 3: one scored factor in the breakdown
/// sheet — symbol, name, the factor's one-line plain-English explanation
/// ("0% chance of rain during the ride."), and a colored status dot. No
/// raw numbers: the sentence is the indicator, the dot is the read-at-a-
/// glance verdict.
public struct FactorRow: View {
    public var score: FactorScore

    public init(score: FactorScore) {
        self.score = score
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: score.factor.symbolName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(score.factor.displayName)
                    .font(.subheadline.weight(.medium))
                Text(score.reason)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Circle()
                .fill(ConditionPalette.color(forScore: score.value))
                .frame(width: 10, height: 10)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(score.factor.displayName), \(verdict). \(score.reason)")
    }

    private var verdict: String {
        switch score.value {
        case 0.7...: "good"
        case 0.4..<0.7: "fair"
        default: "poor"
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        FactorRow(score: FactorScore(factor: .wind, value: 0.85, reason: "Light 8 km/h breeze from the southwest."))
        FactorRow(score: FactorScore(factor: .temperature, value: 0.55, reason: "A little below your preferred range."))
        FactorRow(score: FactorScore(factor: .rain, value: 0.2, reason: "Showers likely after noon."))
    }
    .padding()
}

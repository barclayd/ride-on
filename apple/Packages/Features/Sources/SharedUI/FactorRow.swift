import SwiftUI
import Domain

/// DESIGN-SYSTEM.md §6 component 5: one scoring factor, its score out of 100 as a number and a
/// bar, and the reason in a sentence.
public struct FactorRow: View {
    var factor: RideDetail.Factor

    public init(_ factor: RideDetail.Factor) {
        self.factor = factor
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(factor.name).font(.subheadline.weight(.semibold))
                Spacer()
                Text(factor.score, format: .number).font(.subheadline).monospacedDigit()
            }
            ProgressView(value: Double(factor.score), total: 100)
            Text(factor.reason)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(factor.name), \(factor.score) out of 100")
        .accessibilityValue(factor.reason)
    }
}

#Preview {
    FactorRow(RideDetail.Factor("Wind", score: 94, reason: "Tailwind for 62% of the distance."))
        .padding()
}

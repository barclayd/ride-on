import SwiftUI
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 7: Route Detail's "Best day: Thursday" chip
/// with a mini condition summary. Rendered only when `Recommendations.bestDay`
/// found a day clearing `BestDayScan.threshold` — the caller simply omits
/// this view otherwise (never an empty state).
public struct BestDayBadge: View {
    public var dayName: String
    public var summary: String

    public init(dayName: String, summary: String) {
        self.dayName = dayName
        self.summary = summary
    }

    public var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text("Best day: \(dayName)")
                    .font(.subheadline.weight(.semibold))
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "star.fill")
                .foregroundStyle(.yellow)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        // Content card, not glass — DESIGN-SYSTEM.md §2: "Content cards
        // (stats, factor rows) — Not glass."
        .background(.regularMaterial, in: .rect(cornerRadius: CornerRadius.badge))
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    BestDayBadge(dayName: "Thursday", summary: "Score 78")
        .padding()
}

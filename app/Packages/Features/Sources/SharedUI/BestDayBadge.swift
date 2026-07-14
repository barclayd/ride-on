import SwiftUI
import Engine
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 7: the "when should I ride this" verdict
/// from the 10-day best-day scan. Two states: a recommended day with its
/// tier letter ("Best day: Thursday · Great conditions"), or an explicit
/// "sit it out" when even the best day isn't worth riding — never absent
/// once the scan has run.
public struct BestDayBadge: View {
    public enum Verdict {
        case ride(dayName: String, tier: RideTier, summary: String)
        case skip(days: Int)
    }

    public var verdict: Verdict

    public init(verdict: Verdict) {
        self.verdict = verdict
    }

    /// Builds the verdict straight from a scan result.
    public init(recommendation: DayRecommendation, days: Int = 10) {
        let calendar = Calendar.current
        if recommendation.tier.isWorthRiding {
            let date = recommendation.context.date
            let dayName = calendar.isDateInToday(date) ? "Today"
                : calendar.isDateInTomorrow(date) ? "Tomorrow"
                : date.formatted(.dateTime.weekday(.wide))
            self.verdict = .ride(dayName: dayName, tier: recommendation.tier, summary: recommendation.tier.summary)
        } else {
            self.verdict = .skip(days: days)
        }
    }

    public var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                switch verdict {
                case .ride(let dayName, let tier, let summary):
                    Text("Best day: \(dayName)")
                        .font(.subheadline.weight(.semibold))
                    Text("\(tier.letter) tier · \(summary)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                case .skip(let days):
                    Text("Give it a miss")
                        .font(.subheadline.weight(.semibold))
                    Text("No day worth riding in the next \(days) days")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } icon: {
            switch verdict {
            case .ride(_, let tier, _):
                Text(tier.letter)
                    .font(.system(.subheadline, design: .rounded).bold())
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(tierColor(tier), in: .circle)
            case .skip:
                Image(systemName: "moon.zzz.fill")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        // Content card, not glass — DESIGN-SYSTEM.md §2: "Content cards
        // (stats, factor rows) — Not glass."
        .background(.regularMaterial, in: .rect(cornerRadius: CornerRadius.badge))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("best-day-badge")
    }

    private func tierColor(_ tier: RideTier) -> Color {
        // Tier letters reuse the condition score ramp — same meaning, same
        // color, one palette (DESIGN-SYSTEM.md §3).
        switch tier {
        case .s: ConditionPalette.color(forScore: 0.95)
        case .a: ConditionPalette.color(forScore: 0.78)
        case .b: ConditionPalette.color(forScore: 0.62)
        case .c: ConditionPalette.color(forScore: 0.47)
        case .d: ConditionPalette.color(forScore: 0.2)
        }
    }
}

#Preview {
    VStack(spacing: 12) {
        BestDayBadge(verdict: .ride(dayName: "Thursday", tier: .s, summary: "Perfect conditions"))
        BestDayBadge(verdict: .ride(dayName: "Tomorrow", tier: .b, summary: "Good conditions"))
        BestDayBadge(verdict: .skip(days: 10))
    }
    .padding()
}

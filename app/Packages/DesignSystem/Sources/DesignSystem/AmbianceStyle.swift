import SwiftUI

/// The condition-adaptive gradient wash behind Today cards and onboarding
/// dial screens. Computed from real forecast + time of day, never a stock
/// illustration (DESIGN-SYSTEM.md §3/§1.3).
public enum SkyCondition: String, CaseIterable, Sendable, Equatable {
    case sunny
    case overcast
    case rain
    case night
}

public enum AmbianceStyle {
    /// Resolves the weather-reported sky condition against the time of day —
    /// night always wins so cards don't look "sunny" at 11pm.
    public static func resolvedCondition(sky: SkyCondition, date: Date) -> SkyCondition {
        isNight(date) ? .night : sky
    }

    public static func gradient(sky: SkyCondition, date: Date) -> LinearGradient {
        gradient(for: resolvedCondition(sky: sky, date: date))
    }

    public static func gradient(for condition: SkyCondition) -> LinearGradient {
        switch condition {
        case .sunny:
            LinearGradient(
                colors: [Color(red: 1.0, green: 0.78, blue: 0.45), Color(red: 0.98, green: 0.55, blue: 0.35)],
                startPoint: .top,
                endPoint: .bottom
            )
        case .overcast:
            LinearGradient(
                colors: [Color(white: 0.72), Color(white: 0.58)],
                startPoint: .top,
                endPoint: .bottom
            )
        case .rain:
            LinearGradient(
                colors: [Color(red: 0.28, green: 0.33, blue: 0.42), Color(red: 0.16, green: 0.19, blue: 0.26)],
                startPoint: .top,
                endPoint: .bottom
            )
        case .night:
            LinearGradient(
                colors: [Color(red: 0.06, green: 0.08, blue: 0.2), Color(red: 0.02, green: 0.02, blue: 0.08)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }

    private static func isNight(_ date: Date) -> Bool {
        let hour = Calendar.current.component(.hour, from: date)
        return hour < 6 || hour >= 21
    }
}

/// Crossfades between ambiance states instead of hard-cutting — each gradient
/// is a separate layer whose opacity animates, since SwiftUI can't
/// interpolate between two unrelated `LinearGradient`s directly.
public struct AmbianceBackground: View {
    public var sky: SkyCondition
    public var date: Date
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(sky: SkyCondition, date: Date = .now) {
        self.sky = sky
        self.date = date
    }

    private var resolved: SkyCondition { AmbianceStyle.resolvedCondition(sky: sky, date: date) }

    public var body: some View {
        ZStack {
            ForEach(SkyCondition.allCases, id: \.self) { condition in
                AmbianceStyle.gradient(for: condition)
                    .opacity(condition == resolved ? 1 : 0)
            }
        }
        .animation(reduceMotion ? nil : Motion.ambianceCrossfade, value: resolved)
    }
}

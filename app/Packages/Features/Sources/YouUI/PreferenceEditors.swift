import SwiftUI
import Models
import DesignSystem
import SharedUI

/// Each editor reuses `DialScreen` (DESIGN-SYSTEM.md §6 component 6,
/// "reused verbatim as the Settings editor for each preference"). Full
/// onboarding flow (first-run, page dots wired to a shared flow controller)
/// is Phase 5; these are just the standalone settings-editor use.
struct SunPreferenceEditor: View {
    @Binding var preference: SunPreference
    @Environment(\.dismiss) private var dismiss
    @State private var draft: SunPreference

    init(preference: Binding<SunPreference>) {
        _preference = preference
        _draft = State(initialValue: preference.wrappedValue)
    }

    // The example from DESIGN-SYSTEM.md §6 itself: "rain -> sun reacts to
    // the tap" — the ambiance directly mirrors the selection.
    private var sky: SkyCondition {
        switch draft {
        case .avoid: .rain
        case .neutral: .overcast
        case .seek: .sunny
        }
    }

    var body: some View {
        DialScreen(
            title: "Sun",
            bodyText: "Do you seek out sunshine or avoid it on a ride?",
            sky: sky,
            ctaTitle: "Save"
        ) {
            Picker("Sun preference", selection: $draft) {
                Text("Avoid").tag(SunPreference.avoid)
                Text("Neutral").tag(SunPreference.neutral)
                Text("Seek").tag(SunPreference.seek)
            }
            .pickerStyle(.segmented)
        } onContinue: {
            preference = draft
            dismiss()
        }
    }
}

struct RainToleranceEditor: View {
    @Binding var tolerance: Double
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Double

    init(tolerance: Binding<Double>) {
        _tolerance = tolerance
        _draft = State(initialValue: tolerance.wrappedValue)
    }

    private var sky: SkyCondition {
        switch draft {
        case ..<0.33: .sunny
        case 0.33..<0.66: .overcast
        default: .rain
        }
    }

    var body: some View {
        DialScreen(
            title: "Rain Tolerance",
            bodyText: "How much rain are you willing to ride through?",
            sky: sky,
            ctaTitle: "Save"
        ) {
            Slider(value: $draft, in: 0...1)
        } onContinue: {
            tolerance = draft
            dismiss()
        }
    }
}

struct MaxWindEditor: View {
    @Environment(\.unitSystem) private var unitSystem
    @Binding var maxWindKph: Double
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Double

    init(maxWindKph: Binding<Double>) {
        _maxWindKph = maxWindKph
        _draft = State(initialValue: maxWindKph.wrappedValue)
    }

    var body: some View {
        DialScreen(
            title: "Max Wind",
            bodyText: "What's the strongest wind you're comfortable riding in?",
            sky: .overcast,
            ctaTitle: "Save"
        ) {
            VStack {
                Slider(value: $draft, in: 5...60, step: 1)
                Text(UnitFormat.speed(kph: draft, system: unitSystem)).font(.title3.monospacedDigit()).foregroundStyle(.white)
            }
        } onContinue: {
            maxWindKph = draft
            dismiss()
        }
    }
}

struct TemperatureRangeEditor: View {
    @Binding var range: ClosedRange<Double>
    @Environment(\.dismiss) private var dismiss
    @State private var draftLow: Double
    @State private var draftHigh: Double

    init(range: Binding<ClosedRange<Double>>) {
        _range = range
        _draftLow = State(initialValue: range.wrappedValue.lowerBound)
        _draftHigh = State(initialValue: range.wrappedValue.upperBound)
    }

    var body: some View {
        DialScreen(
            title: "Preferred Temperature",
            bodyText: "Your comfortable riding range, in Celsius.",
            sky: .sunny,
            ctaTitle: "Save"
        ) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading) {
                    Text("Low: \(UnitFormat.temperature(c: draftLow))").foregroundStyle(.white)
                    Slider(value: $draftLow, in: -5...30, step: 1)
                }
                VStack(alignment: .leading) {
                    Text("High: \(UnitFormat.temperature(c: draftHigh))").foregroundStyle(.white)
                    Slider(value: $draftHigh, in: -5...30, step: 1)
                }
            }
        } onContinue: {
            range = min(draftLow, draftHigh)...max(draftLow, draftHigh)
            dismiss()
        }
    }
}

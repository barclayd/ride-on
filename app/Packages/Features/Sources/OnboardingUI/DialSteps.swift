import SwiftUI
import Models
import DesignSystem
import SharedUI

// Steps 1-4: the four reactive weather-dial screens named in the decision
// record (temp/sun/rain/wind) — the animation centrepiece. Each computes its
// `DialScreen` `sky` from the live control value, so `AmbianceBackground`
// crossfades (`Motion.ambianceCrossfade`) as the rider drags/taps, exactly
// like the DESIGN-SYSTEM.md §6 example ("rain -> sun reacts to the tap").
// Step 5 (novelty) gets the same reactive treatment for a consistent feel,
// though it isn't one of the four named weather dials.

struct TemperatureDialStep: View {
    @Binding var range: ClosedRange<Double>
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void

    // No dedicated "cold" sky in the 4-state enum, so `.rain`'s cool
    // blue-grey doubles as the cold mood here; `.sunny` for warm.
    private var sky: SkyCondition {
        switch (range.lowerBound + range.upperBound) / 2 {
        case 20...: .sunny
        case 10..<20: .overcast
        default: .rain
        }
    }

    var body: some View {
        DialScreen(
            title: "Temperature",
            bodyText: "Your comfortable riding range, in Celsius.",
            sky: sky,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading) {
                    Text("Low: \(UnitFormat.temperature(c: range.lowerBound))").foregroundStyle(.white)
                    Slider(
                        value: Binding(
                            get: { range.lowerBound },
                            set: { range = min($0, range.upperBound)...range.upperBound }
                        ),
                        in: -5...30, step: 1
                    )
                }
                VStack(alignment: .leading) {
                    Text("High: \(UnitFormat.temperature(c: range.upperBound))").foregroundStyle(.white)
                    Slider(
                        value: Binding(
                            get: { range.upperBound },
                            set: { range = range.lowerBound...max($0, range.lowerBound) }
                        ),
                        in: -5...30, step: 1
                    )
                }
            }
        } onContinue: { onContinue() }
    }
}

struct SunDialStep: View {
    @Binding var preference: SunPreference
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void

    private var sky: SkyCondition {
        switch preference {
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
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            Picker("Sun preference", selection: $preference) {
                Text("Avoid").tag(SunPreference.avoid)
                Text("Neutral").tag(SunPreference.neutral)
                Text("Seek").tag(SunPreference.seek)
            }
            .pickerStyle(.segmented)
        } onContinue: { onContinue() }
    }
}

struct RainDialStep: View {
    @Binding var tolerance: Double
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var sky: SkyCondition {
        switch tolerance {
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
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            Slider(value: $tolerance, in: 0...1) {
                Text("Rain tolerance")
            } minimumValueLabel: {
                endSymbol(dry: true)
            } maximumValueLabel: {
                endSymbol(dry: false)
            }
        } onContinue: { onContinue() }
    }

    // Dry/downpour ends of the slider: opacity crossfades with the value,
    // and the dominant side plays a short symbol animation (Reduce Motion
    // gated), matching the reactive sky background. One function for both so
    // Slider's min/max labels share a `ValueLabel` type. Finite `.repeat(3)`,
    // not `.repeating` — a forever animation stops the app ever idling, which
    // makes XCUITest event delivery flaky (and burns battery on a screen
    // someone may sit on).
    @ViewBuilder
    private func endSymbol(dry: Bool) -> some View {
        let image = Image(systemName: dry ? "sun.max.fill" : "cloud.heavyrain.fill")
            .font(.title3)
        Group {
            if dry {
                image.symbolEffect(.pulse, options: .repeat(3), isActive: !reduceMotion && tolerance < 0.33)
            } else {
                image.symbolEffect(.variableColor.iterative, options: .repeat(3), isActive: !reduceMotion && tolerance >= 0.66)
            }
        }
        .opacity(0.35 + 0.65 * (dry ? 1 - tolerance : tolerance))
        .animation(Motion.ambianceCrossfade, value: tolerance)
        .accessibilityHidden(true)
    }
}

struct WindDialStep: View {
    @Environment(\.unitSystem) private var unitSystem
    @Binding var maxWindKph: Double
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void

    private var sky: SkyCondition {
        switch maxWindKph {
        case ..<15: .sunny
        case 15..<35: .overcast
        default: .rain
        }
    }

    var body: some View {
        DialScreen(
            title: "Max Wind",
            bodyText: "What's the strongest wind you're comfortable riding in?",
            sky: sky,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            VStack {
                Slider(value: $maxWindKph, in: 5...60, step: 1)
                Text(UnitFormat.speed(kph: maxWindKph, system: unitSystem)).font(.title3.monospacedDigit()).foregroundStyle(.white)
            }
        } onContinue: { onContinue() }
    }
}

struct NoveltyDialStep: View {
    @Binding var noveltyDial: Double
    var pageIndex: Int
    var pageCount: Int
    var onContinue: () -> Void

    private var sky: SkyCondition {
        switch noveltyDial {
        case ..<0.33: .overcast
        case 0.33..<0.66: .sunny
        default: .sunny
        }
    }

    var body: some View {
        DialScreen(
            title: "Novelty",
            bodyText: "Stick with favourite routes, or should Ride On nudge you toward something new?",
            sky: sky,
            pageIndex: pageIndex,
            pageCount: pageCount
        ) {
            VStack {
                Slider(value: $noveltyDial, in: 0...1)
                HStack {
                    Text("Favourites").font(.caption)
                    Spacer()
                    Text("Explore").font(.caption)
                }
                .foregroundStyle(.white.opacity(0.8))
            }
        } onContinue: { onContinue() }
    }
}

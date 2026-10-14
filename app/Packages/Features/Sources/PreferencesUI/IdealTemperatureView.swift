import SwiftUI
import Models
import Services
import SharedUI

/// Ideal Temperature (docs/redesign/README.md §6): the comfort range, how each route's forecast
/// sits against it, and the temperature deal-breakers. Saves as you drag.
struct IdealTemperatureView: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(\.locale) private var locale

    var body: some View {
        let settings = store.binding
        let range = settings.wrappedValue.preferences.temperature.comfortMinC...settings.wrappedValue.preferences.temperature.comfortMaxC
        Form {
            Section {
                VStack(spacing: 16) {
                    HStack(spacing: 10) {
                        Text(UnitFormat.degrees(c: range.lowerBound, locale: locale))
                        Capsule().fill(.tertiary).frame(width: 28, height: 5)
                        Text(UnitFormat.degrees(c: range.upperBound, locale: locale))
                    }
                    .font(.system(size: 64, weight: .bold).monospacedDigit())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(UnitFormat.temperatureRange(c: range, locale: locale))
                    Text("The range you'd happily ride in")
                        .foregroundStyle(.secondary)
                    TemperatureRange(Binding(
                        get: { range },
                        set: {
                            settings.wrappedValue.preferences.temperature.comfortMinC = $0.lowerBound
                            settings.wrappedValue.preferences.temperature.comfortMaxC = $0.upperBound
                        }), in: min(0, range.lowerBound)...max(35, range.upperBound))
                    Text("Inside this range, temperature scores full marks. Outside it, the score falls away gently rather than all at once.")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 8)
            }

            if let picks = store.board?.picks, !picks.isEmpty {
                Section {
                    ForEach(picks) { pick in
                        fitRow(pick, against: range)
                    }
                } header: {
                    Text("How Your Routes Fit")
                } footer: {
                    Text(fitSummary(picks, against: range))
                }
            }

            dealBreakers(settings.preferences.minimumStandards)
        }
        .formStyle(.grouped)
        .navigationTitle("Ideal Temperature")
        .toolbarTitleDisplayMode(.inline)
    }

    private func fitRow(_ pick: RideBoard.Pick, against range: ClosedRange<Double>) -> some View {
        let temperature = pick.conditions.temperatureC
        let miss = miss(temperature, range)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pick.route.name).font(.headline).lineLimit(1)
                Text("\(pick.start.formatted(.dateTime.weekday(.abbreviated))) · \(UnitFormat.temperatureRange(c: temperature, locale: locale))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            TemperatureRange.Bar(temperature, against: range)
                .frame(width: 96, height: 6)
            Group {
                if let miss {
                    Text("\(miss.degrees)° \(miss.under ? "under" : "over")").foregroundStyle(.secondary)
                } else {
                    Text("In range").foregroundStyle(Color.accentColor)
                }
            }
            .font(.subheadline.weight(.semibold))
            .frame(minWidth: 72, alignment: .trailing)
        }
        .accessibilityElement(children: .combine)
    }

    private func fitSummary(_ picks: [RideBoard.Pick], against range: ClosedRange<Double>) -> String {
        guard let pick = picks.first(where: { miss($0.conditions.temperatureC, range) != nil }),
              let miss = miss(pick.conditions.temperatureC, range) else {
            return "Every route sits inside your range, so temperature isn't holding any of them back."
        }
        let temperature = pick.conditions.temperatureC
        let reach = miss.under
            ? "goes down to \(UnitFormat.degrees(c: temperature.lowerBound, locale: locale)), \(miss.degrees)° under"
            : "reaches \(UnitFormat.degrees(c: temperature.upperBound, locale: locale)), \(miss.degrees)° over"
        // ponytail: "so it loses 2 points" needs the API's per-route preview
        // (docs/redesign/preferences-api-requests.md, item 2).
        return "\(pick.route.name) \(reach) your range, so it scores a little lower. Rides re-rank as you drag."
    }

    /// How far a route's forecast falls outside the range, in whole display degrees; `nil` inside it.
    private func miss(_ temperature: ClosedRange<Double>, _ range: ClosedRange<Double>) -> (degrees: Int, under: Bool)? {
        let scale = UnitTemperature(forLocale: locale, usage: .weather) == .fahrenheit ? 1.8 : 1
        let under = Int(((range.lowerBound - temperature.lowerBound) * scale).rounded())
        let over = Int(((temperature.upperBound - range.upperBound) * scale).rounded())
        if under > 0 { return (under, true) }
        if over > 0 { return (over, false) }
        return nil
    }

    private func dealBreakers(_ limits: Binding<RiderSettings.Preferences.MinimumStandards>) -> some View {
        let floor = limits.wrappedValue.minimumTemperature
        let ceiling = limits.wrappedValue.maximumTemperatureC
        // Editing a monthly floor rebuilds it from the new summer value.
        let setFloor: (Double?) -> Void = { c in
            limits.wrappedValue.minimumTemperature = c.map { floor?.isMonthly == true ? .monthly($0) : .fixed($0) }
        }
        return Section {
            Stepper {
                LabeledContent("Never Colder Than", value: floor.map { UnitFormat.degrees(c: $0.baseC, locale: locale) } ?? "None")
            } onIncrement: {
                setFloor(floor.map { min($0.baseC + 1, 20) } ?? -10)
            } onDecrement: {
                // Below −10° the limit comes off.
                guard let floor else { return }
                setFloor(floor.baseC <= -10 ? nil : floor.baseC - 1)
            }
            Stepper {
                LabeledContent("Never Hotter Than", value: ceiling.map { UnitFormat.degrees(c: $0, locale: locale) } ?? "None")
            } onIncrement: {
                // Above 40° the limit comes off.
                guard let ceiling else { return }
                limits.wrappedValue.maximumTemperatureC = ceiling >= 40 ? nil : ceiling + 1
            } onDecrement: {
                limits.wrappedValue.maximumTemperatureC = ceiling.map { max($0 - 1, 20) } ?? 40
            }
            Toggle("Vary by Month", isOn: Binding(
                get: { floor?.isMonthly == true },
                set: { isOn in floor.map { limits.wrappedValue.minimumTemperature = isOn ? .monthly($0.baseC) : .fixed($0.baseC) } }))
                .disabled(floor == nil)
        } header: {
            Text("Deal-Breakers")
        } footer: {
            Text("Rides outside these are marked Below your minimums. Turn on Vary by Month to accept colder starts in winter.")
        }
        .sensoryFeedback(.selection, trigger: limits.wrappedValue)
    }
}

#Preview {
    NavigationStack { IdealTemperatureView() }
        .environment(RiderSettingsStore(live: false))
}

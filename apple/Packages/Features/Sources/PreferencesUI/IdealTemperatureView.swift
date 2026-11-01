import SwiftUI
import Domain
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
        // Points only from a board scored with this range; mid-drag it can't say.
        let points = store.board?.scoredWith?.temperatureC == range ? pick.gainSentence("temperature") : nil
        return ["\(pick.route.name) \(reach) your range.", points, "Rides re-rank as you drag."].compactMap(\.self).joined(separator: " ")
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
        return Section {
            if floor?.isMonthly == true {
                NavigationLink { MonthlyFloorView() } label: {
                    LabeledContent("Never Colder Than", value: "By Month")
                }
            } else {
                let c = floor?.valueC
                Stepper {
                    LabeledContent("Never Colder Than", value: c.map { UnitFormat.degrees(c: $0, locale: locale) } ?? "None")
                } onIncrement: {
                    limits.wrappedValue.minimumTemperature = .fixed(c.map { min($0 + 1, 20) } ?? -10)
                } onDecrement: {
                    // Below −10° the limit comes off.
                    guard let c else { return }
                    limits.wrappedValue.minimumTemperature = c <= -10 ? nil : .fixed(c - 1)
                }
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
                set: { isOn in
                    guard let floor else { return }
                    // On: today's limit in every month, to change month by month. Off: this month's.
                    let c = isOn ? floor.valueC : floor.valueC(in: Calendar.current.component(.month, from: .now)) ?? floor.valuesC?.values.min()
                    limits.wrappedValue.minimumTemperature = c.map { isOn ? .monthly($0) : .fixed($0) }
                }))
                .disabled(floor == nil)
        } header: {
            Text("Deal-Breakers")
        } footer: {
            Text("Rides outside these are marked Below your minimums.")
        }
        .sensoryFeedback(.selection, trigger: limits.wrappedValue)
    }
}

/// The rider's own Never Colder Than for each month (docs/redesign/preferences-api-requests.md §6).
/// Nothing is filled in for them: a month left unset uses the fallback, or has no limit.
struct MonthlyFloorView: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(\.locale) private var locale

    var body: some View {
        let floor = store.binding.preferences.minimumStandards.minimumTemperature
        let values = floor.wrappedValue?.valuesC ?? [:]
        let fallback = floor.wrappedValue?.fallbackC
        let set: (Int, Double?) -> Void = { month, c in
            var changed = values
            changed["\(month)"] = c
            floor.wrappedValue?.valuesC = changed
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        return Form {
            Section {
                ForEach(1...12, id: \.self) { month in
                    let c = values["\(month)"]
                    Stepper {
                        LabeledContent(calendar.standaloneMonthSymbols[month - 1], value: c.map { UnitFormat.degrees(c: $0, locale: locale) } ?? "Not Set")
                    } onIncrement: {
                        set(month, c.map { min($0 + 1, 20) } ?? fallback ?? -10)
                    } onDecrement: {
                        // Below −10° the month's limit comes off.
                        guard let c else { return }
                        set(month, c <= -10 ? nil : c - 1)
                    }
                }
            } footer: {
                Text(fallback.map { "Months not set use \(UnitFormat.degrees(c: $0, locale: locale))." } ?? "Months not set have no limit.")
            }
            .sensoryFeedback(.selection, trigger: values)
        }
        .formStyle(.grouped)
        .navigationTitle("Never Colder Than")
        .toolbarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack { IdealTemperatureView() }
        .environment(RiderSettingsStore(live: false))
}

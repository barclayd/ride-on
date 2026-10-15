import SwiftUI
import Models
import Services
import SharedUI

/// Comfortable Wind (docs/redesign/README.md §7): the envelope, the sliders that set it, and how
/// each route's forecast wind sits against it. Saves as you drag.
struct ComfortableWindView: View {
    @Environment(RiderSettingsStore.self) private var store
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.locale) private var locale

    /// The gust limit slider's top end, which means no limit.
    private static let noGustLimit = 80.0

    var body: some View {
        let settings = store.binding
        let wind = settings.preferences.wind
        let maximumGust = settings.preferences.minimumStandards.maximumGustKph
        Form {
            Section {
                WindEnvelope(headwindKph: wind.wrappedValue.comfortableHeadwindKph, crosswindKph: wind.wrappedValue.comfortableCrosswindKph,
                             gustKph: maximumGust.wrappedValue)
                    .frame(height: 300)
                Text("Speeds in \(speedSystem == .metric ? "km/h" : "mph"). You ride up the page: the shaded shape is wind you're happy with, the dashed ring is your maximum gust limit.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .listRowSeparator(.hidden)
            }

            Section {
                limit("Headwind", value: wind.comfortableHeadwindKph, in: 5...40, tint: .accentColor)
                limit("Crosswind", value: wind.comfortableCrosswindKph, in: 5...40, tint: .accentColor)
                limit(Self.gustLimit, value: Binding(
                    get: { maximumGust.wrappedValue ?? Self.noGustLimit },
                    set: { maximumGust.wrappedValue = $0 >= Self.noGustLimit ? nil : $0 }), in: 20...Self.noGustLimit, tint: .blue)
                // ponytail: hidden on an API older than v0.25.0, which has no level to save.
                if let level = settings.wrappedValue.crosswind {
                    Picker("Crosswind Sensitivity", selection: settings.crosswind) {
                        Text("Low").tag(RiderSettings.CrosswindLevel?.some(.low))
                        Text("Normal").tag(RiderSettings.CrosswindLevel?.some(.normal))
                        Text("High").tag(RiderSettings.CrosswindLevel?.some(.high))
                        // Set outside the app; kept until the rider picks a level.
                        if level == .custom { Text("Custom").tag(RiderSettings.CrosswindLevel?.some(.custom)) }
                    }
                    .tint(.secondary)
                }
            } header: {
                Text("Limits")
            } footer: {
                Text("Wind over your headwind or crosswind comfort scores lower. Gusts over the limit mark a ride Below your minimums.")
            }

            if let picks = store.board?.picks, !picks.isEmpty {
                Section {
                    ForEach(picks) { pick in
                        fitRow(pick, settings.wrappedValue.preferences)
                    }
                } header: {
                    Text("How Your Routes Fit")
                } footer: {
                    Text(fitSummary(picks, settings.wrappedValue.preferences))
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Comfortable Wind")
        .toolbarTitleDisplayMode(.inline)
    }

    private func limit(_ title: String, value: Binding<Double>, in range: ClosedRange<Double>, tint: Color) -> some View {
        VStack(alignment: .leading) {
            LabeledContent(title, value: title == Self.gustLimit && value.wrappedValue >= Self.noGustLimit
                           ? "No Limit" : UnitFormat.speed(kph: value.wrappedValue, system: speedSystem, locale: locale))
            Slider(value: value, in: range, step: 1)
                .tint(tint)
                .accessibilityLabel(title)
                .sensoryFeedback(.selection, trigger: value.wrappedValue)
        }
    }

    private static let gustLimit = "Gust Limit"

    private enum Fit { case inRange, over(kph: Double), gusts(over: Double) }

    private func fit(_ conditions: RideBoard.Conditions, _ preferences: RiderSettings.Preferences) -> Fit {
        if let maximum = preferences.minimumStandards.maximumGustKph, conditions.gustKph > maximum {
            return .gusts(over: conditions.gustKph - maximum)
        }
        let limit: Double? = switch conditions.wind {
        case .headwind: preferences.wind.comfortableHeadwindKph
        case .crosswind: preferences.wind.comfortableCrosswindKph
        case .tailwind: nil
        }
        if let limit, conditions.windKph > limit { return .over(kph: conditions.windKph - limit) }
        return .inRange
    }

    private func fitRow(_ pick: RideBoard.Pick, _ preferences: RiderSettings.Preferences) -> some View {
        let conditions = pick.conditions
        let fit = fit(conditions, preferences)
        let day = pick.start.formatted(.dateTime.weekday(.abbreviated))
        let detail = if case .gusts = fit {
            "Gusts \(speed(conditions.gustKph))"
        } else {
            "\(speed(conditions.windKph)) \(conditions.wind.rawValue)"
        }
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(pick.route.name).font(.headline).lineLimit(1)
                Text("\(day) · \(detail)").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Group {
                switch fit {
                case .inRange:
                    Text("In range").foregroundStyle(Color.accentColor)
                case .over(let kph):
                    Text("\(number(kph)) over").foregroundStyle(.secondary)
                case .gusts(let kph):
                    Label("\(number(kph)) over", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                }
            }
            .font(.subheadline.weight(.semibold))
        }
        .accessibilityElement(children: .combine)
    }

    private func fitSummary(_ picks: [RideBoard.Pick], _ preferences: RiderSettings.Preferences) -> String {
        for pick in picks {
            switch fit(pick.conditions, preferences) {
            case .gusts(let kph):
                let gust = pick.conditions.gustKph
                let fix = (gust / 5).rounded(.up) * 5 < Self.noGustLimit
                    ? "Raise the gust limit to \(speed((gust / 5).rounded(.up) * 5)) and it ranks normally."
                    : "Set the gust limit to No Limit and it ranks normally."
                return "\(pick.route.name)'s gusts are \(speed(kph)) over your limit, so it's marked Below your minimums. \(fix)"
            case .over(let kph):
                // Points only from a board scored with these limits; mid-drag it can't say.
                // ponytail: `scoredWith` leaves out the crosswind level, so for the second or two
                // until Rides reloads after a level change, the points describe the old one.
                let scored = store.board?.scoredWith
                let points = scored?.headwindKph == preferences.wind.comfortableHeadwindKph
                    && scored?.crosswindKph == preferences.wind.comfortableCrosswindKph ? pick.gainSentence("wind") : nil
                return ["\(pick.route.name)'s \(pick.conditions.wind.rawValue) is \(speed(kph)) more than you're comfortable with.", points]
                    .compactMap(\.self).joined(separator: " ")
            case .inRange:
                continue
            }
        }
        return "Every route's wind sits inside your limits."
    }

    private func speed(_ kph: Double) -> String {
        UnitFormat.speed(kph: kph, system: speedSystem, locale: locale)
    }

    private func number(_ kph: Double) -> String {
        (speedSystem == .metric ? kph : kph / 1.609344).formatted(.number.precision(.fractionLength(0)).locale(locale))
    }
}

#Preview {
    NavigationStack { ComfortableWindView() }
        .environment(RiderSettingsStore(live: false))
}

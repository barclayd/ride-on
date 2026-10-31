import SwiftUI
import Models
import DesignSystem
import SharedUI

/// DESIGN-SYSTEM.md §6 component 20: the selected route over the Routes map on the open iPhone
/// Duo, where the library is the pane beside the map. What its row says, bigger, and the way to
/// the ride Rides has for it.
struct RouteCard: View {
    var route: RouteLibrary.Route
    /// How it's faring on Rides, when it's shortlisted.
    var status: ShortlistStatus?
    /// The day it was ridden, when it was picked from History.
    var riddenOn: Date?
    var pick: RideBoard.Pick?

    @Environment(\.unitSystem) private var unitSystem

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    kicker
                    Text(route.name)
                        .font(.title2.bold())
                        .lineLimit(2)
                    Text(route.statsLine(unitSystem))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let pick {
                    ScoreGauge(score: pick.score, tint: pick.meetsMinimums ? .accentColor : .belowMinimums, size: 56)
                }
            }
            FlowLayout(spacing: 6) {
                if status != nil {
                    ConditionChip("Shortlisted", systemImage: "star.fill")
                }
                if let pick {
                    ConditionChip("About \(Duration.seconds(pick.finish.timeIntervalSince(pick.start)).formatted(.units(allowed: [.hours, .minutes], width: .narrow)))",
                                  systemImage: "clock")
                }
                ConditionChip(route.lastRidden.map { "Last ridden \(RoutesFormat.shortDate($0))" } ?? "Never ridden",
                              systemImage: "clock.arrow.circlepath")
            }
            if let pick {
                NavigationLink(value: pick) {
                    Text("See \(pick.start.formatted(.dateTime.weekday(.wide)))’s Ride")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
        .padding(18)
        .accessibleGlass(.regular, in: .rect(cornerRadius: 30), fallback: .groupedBackground)
    }

    @ViewBuilder private var kicker: some View {
        Group {
            if let riddenOn {
                Text("Ridden \(RoutesFormat.shortDate(riddenOn))")
                    .foregroundStyle(.secondary)
            } else {
                switch status {
                case .best(let day)?:
                    Label(ShortlistStatus.best(day: day).text, systemImage: "star.fill")
                        .foregroundStyle(.tint)
                case .ranked(let start)?:
                    Text("Ranked · \(start)")
                        .foregroundStyle(.tint)
                case .belowMinimums?:
                    Text(ShortlistStatus.belowMinimums.text)
                        .foregroundStyle(Color.belowMinimums)
                case let other?:
                    Text(other.text)
                        .foregroundStyle(.secondary)
                case nil:
                    Text("Library")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .font(.footnote.weight(.semibold))
        .labelStyle(.titleAndIcon)
    }
}

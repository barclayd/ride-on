import SwiftUI
import Domain
import DesignSystem
import SharedUI

/// A saved route that isn't on the shortlist: its outline, stats, source and when it was last
/// ridden, with a plus to shortlist it. Selected, it shows it on the map and offers its actions.
struct LibraryRow: View {
    var route: RouteLibrary.Route
    var isSelected: Bool
    /// False once the shortlist is full.
    var canAdd: Bool
    var pick: RideBoard.Pick?
    var select: () -> Void
    var add: () -> Void

    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        PanelRow(coordinates: route.coordinates, isSelected: isSelected, select: select) {
            Text(route.name)
                .font(.headline)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
            Text(route.statsLine(unitSystem))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            Text("\(route.source.title) · \(route.lastRidden.map { "Ridden \(RoutesFormat.shortDate($0))" } ?? "Never ridden")")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        } trailing: {
            Button(action: add) {
                Image(systemName: "plus.circle")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .disabled(!canAdd)
            .accessibilityLabel("Add \(route.name) to Shortlist")
        } actions: {
            RowActions(canAdd: canAdd, showsAdd: true, pick: pick, add: add)
        }
    }
}

/// A ride marked as ridden: the route as it was, the day, and the forecast saved when it was
/// planned. Never the weather on the day (docs/ride-history.md).
struct HistoryRow: View {
    var ride: RouteLibrary.Ride
    var isSelected: Bool
    /// Whether the ride's route can go on the shortlist: it's in the library, not on the
    /// shortlist already.
    var showsAdd: Bool
    var canAdd: Bool
    var pick: RideBoard.Pick?
    var select: () -> Void
    var add: () -> Void

    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let large = dynamicTypeSize.isAccessibilitySize
        let heading = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 1)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        PanelRow(coordinates: ride.route.coordinates, isSelected: isSelected, select: select) {
            heading {
                Text(ride.route.name)
                    .font(.headline)
                    .lineLimit(large ? 3 : 1)
                if !large { Spacer(minLength: 0) }
                Text(ride.riddenOn.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .fixedSize()
            }
            Text(ride.route.statsLine(unitSystem))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            Group {
                if let plan = ride.plan {
                    HStack(spacing: 3) {
                        Image(systemName: plan.sky.outlineSymbol)
                            .accessibilityLabel(plan.sky.title)
                        Text(UnitFormat.degrees(c: plan.temperatureC, locale: locale))
                            .padding(.trailing, 6)
                        Image(systemName: "wind")
                            .accessibilityLabel("Wind")
                        Text("\(UnitFormat.speed(kph: plan.windKph, system: speedSystem)) · Planned \(plan.start.formatted(.clockTime))")
                    }
                    .monospacedDigit()
                } else {
                    Text("No forecast saved")
                }
            }
            .font(.footnote)
            .foregroundStyle(.tertiary)
            .lineLimit(large ? nil : 1)
        } trailing: {
            EmptyView()
        } actions: {
            RowActions(canAdd: canAdd, showsAdd: showsAdd, pick: pick, add: add)
        }
    }
}

/// "Add to Shortlist" and "Details", under a selected row. Details opens Ride detail, so it's
/// there only for a route Rides has ranked.
private struct RowActions: View {
    var canAdd: Bool
    var showsAdd: Bool
    var pick: RideBoard.Pick?
    var add: () -> Void

    var body: some View {
        if showsAdd {
            Button("Add to Shortlist", action: add)
                .buttonStyle(.borderedProminent)
                .disabled(!canAdd)
        }
        if let pick {
            NavigationLink(value: pick) {
                HStack(spacing: 3) {
                    Text("Details")
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                }
            }
            .buttonStyle(.bordered)
            .tint(.primary)
        }
    }
}

/// Thumbnail and text, then `trailing`; selected, the row fills and shows `actions` beneath,
/// lined up with the text. At accessibility sizes the text drops below the thumbnail
/// (DESIGN-SYSTEM.md §8).
private struct PanelRow<Content: View, Trailing: View, Actions: View>: View {
    var coordinates: [Coordinate]
    var isSelected: Bool
    var select: () -> Void
    @ViewBuilder var content: Content
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var actions: Actions

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Button(action: select) {
                    Group {
                        if stacked {
                            VStack(alignment: .leading, spacing: 8) {
                                thumbnail
                                text
                            }
                        } else {
                            HStack(spacing: 12) {
                                thumbnail
                                text
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
                .accessibilityHint(isSelected ? "" : "Shows it on the map")
                trailing
            }
            if isSelected {
                FlowLayout(spacing: 8) { actions }
                    .buttonBorderShape(.capsule)
                    .font(.subheadline.weight(.semibold))
                    .padding(.top, 10)
                    .padding(.bottom, 2)
                    .padding(.leading, stacked ? 0 : 60)
                    .transition(.opacity)
            }
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 10)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: CornerRadius.selectedRow)
                    .fill(.fill.tertiary)
            }
        }
        .padding(.horizontal, 8)
    }

    private var thumbnail: some View {
        RouteMap(coordinates, style: .thumbnail)
            .frame(width: 48, height: 48)
            .clipShape(.rect(cornerRadius: CornerRadius.panelThumbnail))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: 1) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum RoutesFormat {
    /// "3 Oct", with the year when it isn't this year's.
    static func shortDate(_ date: Date) -> String {
        let sameYear = Calendar.current.isDate(date, equalTo: .now, toGranularity: .year)
        return date.formatted(sameYear ? .dateTime.day().month(.abbreviated) : .dateTime.day().month(.abbreviated).year())
    }
}

extension RouteLibrary.Route {
    /// "42 km · 180 m · 46% unpaved".
    func statsLine(_ system: UnitSystem) -> String {
        let surface = switch unpaved {
        case nil: "Surface unknown"
        case let share? where share <= 0: "Paved"
        case let share?: "\(share.formatted(.percent.precision(.fractionLength(0)))) unpaved"
        }
        return "\(UnitFormat.distance(km: distanceKm, system: system, fractionDigits: 0)) · \(UnitFormat.elevation(m: ascentM, system: system)) · \(surface)"
    }
}

private extension RideBoard.Sky {
    /// Outline symbols, as in Ride detail's forecast: a saved forecast, not a live one.
    var outlineSymbol: String {
        switch self {
        case .sunny: "sun.max"
        case .sunnySpells: "cloud.sun"
        case .cloudy: "cloud"
        case .rain: "cloud.rain"
        }
    }
}

import SwiftUI
import WidgetKit
import Models
import DesignSystem

/// Widgets D, the tracked ride (docs/redesign/README.md §8): the score and conditions first, the ride
/// time where "leave in" was, the ridden part of the loop gold.
struct TrackedView: View {
    var family: WidgetFamily
    var tracked: RideWidgetSnapshot.Tracked
    var units: RideWidgetSnapshot.Units
    var date: Date

    var body: some View {
        content.widgetURL(RideLink(pick: ride.id).url)
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .systemMedium: medium
        case .systemLarge: large
        case .systemExtraLarge: extraLarge
        #if os(iOS)
        case .accessoryInline:
            Label("\(ride.name) \(tracked.score) · \(units.temperatures(ride.temperatureC)) · \(ride.wind.title) \(units.wind(ride.windKph))",
                  systemImage: "bell.fill")
        case .accessoryCircular: gauge.gaugeStyle(.accessoryCircular)
        case .accessoryRectangular:
            HStack(spacing: 6) {
                gauge.gaugeStyle(.accessoryCircular)
                VStack(alignment: .leading, spacing: 0) {
                    Label(ride.name, systemImage: "bell.fill").font(.headline).widgetAccentable()
                    Text("\(units.temperatures(ride.temperatureC)) · \(ride.wind.title) \(units.wind(ride.windKph))")
                    Text(ride.rideTime(at: date, short: true)).foregroundStyle(.secondary)
                }
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        #endif
        default: small
        }
    }

    private var ride: RideWidgetSnapshot.Ride { tracked.ride }

    private var progress: Double? {
        guard date >= ride.start else { return nil }
        return min(1, date.timeIntervalSince(ride.start) / max(ride.finish.timeIntervalSince(ride.start), 1))
    }

    private func arc(_ size: CGFloat) -> ScoreArc {
        ScoreArc(score: tracked.score, change: tracked.change, warn: tracked.warn, size: size)
    }

    private func map(_ shape: WidgetMap.Shape, hours: Bool = false) -> some View {
        MapPanel(ride: ride, shape: shape, units: units, progress: progress, hours: hours)
    }

    // MARK: Home Screen

    private var small: some View {
        VStack(spacing: 0) {
            map(.band)
                .frame(height: 76)
                .overlay(alignment: .topLeading) { when(short: true).padding(8) }
            HStack(spacing: 8) {
                arc(50)
                Conds(tracked: tracked, units: units, size: 11)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxHeight: .infinity)
        }
    }

    private var medium: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                title
                HStack(spacing: 10) {
                    arc(76)
                    Conds(tracked: tracked, units: units, size: 13)
                }
                Text(ride.rideTime(at: date)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            map(.tall)
                .frame(width: 148)
                .overlay(alignment: .bottomTrailing) { windChip.padding(6) }
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            map(.band, hours: true)
                .frame(height: 176)
                .overlay(alignment: .topLeading) { when().padding(8) }
                .overlay(alignment: .bottomTrailing) { windChip.padding(8) }
            HStack(spacing: 12) {
                arc(86)
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(ride.name) · \(units.distance(ride.distanceKm))").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    Conds(tracked: tracked, units: units, size: 13)
                }
            }
            .padding(.horizontal, 14)
            Heading(text: "Along the ride").padding(.horizontal, 14)
            HourCells(ride: ride, units: units).padding(.horizontal, 8)
            Spacer(minLength: 0)
        }
    }

    private var extraLarge: some View {
        HStack(spacing: 0) {
            map(.square, hours: true)
                .overlay(alignment: .topLeading) { when().padding(8) }
                .overlay(alignment: .bottomTrailing) { windChip.padding(8) }
                .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    title
                    Spacer()
                    if let checked = tracked.checkedAt {
                        Text("Checked \(checked.clock)").font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 14) {
                    arc(124)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(ride.name).font(.system(size: 17, weight: .bold))
                        Text("\(units.distance(ride.distanceKm)) · \(units.climb(ride.ascentM)) · \(ride.start.clock) → ~\(ride.finish.clock)")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                        Conds(tracked: tracked, units: units, size: 15)
                    }
                    .lineLimit(1)
                }
                Spacer(minLength: 0)
                Heading(text: "Along the ride")
                HourCells(ride: ride, units: units)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: Parts

    /// "🔔 HILLY LOOP · TODAY", in the committed gold.
    private var title: some View {
        Label("\(ride.name) · \(ride.start.dayWord(from: date))".uppercased(), systemImage: "bell.fill")
            .font(.system(size: 10, weight: .semibold))
            .kerning(0.4)
            .foregroundStyle(Color.committed)
            .lineLimit(1)
    }

    private func when(short: Bool = false) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "bell.fill").foregroundStyle(Color.committed)
            Text(ride.rideTime(at: date, short: short))
        }
        .lineLimit(1)
        .mapChip()
    }

    private var windChip: some View {
        HStack(spacing: 2) {
            Image(systemName: ride.wind.systemImage).foregroundStyle(ride.wind.tint)
            Text(units.windSpeed(ride.windKph))
        }
        .mapChip()
    }

    #if os(iOS)
    private var gauge: some View {
        Gauge(value: Double(tracked.score), in: 0...100) {
            Image(systemName: "bell.fill")
        } currentValueLabel: {
            Text("\(tracked.score)")
        }
    }
    #endif
}

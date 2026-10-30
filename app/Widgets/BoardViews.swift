import SwiftUI
import WidgetKit
import AppIntents
import Models
import DesignSystem

/// Widgets A, the departure board (docs/redesign/README.md §8): the paged day's best ride on its
/// map, the window's days below. A tap opens the ride; Track opens its Track sheet.
struct BoardView: View {
    var family: WidgetFamily
    var snapshot: RideWidgetSnapshot
    /// The day shown: paged to, else the best.
    var day: RideWidgetSnapshot.Day
    var date: Date

    var body: some View {
        let days = snapshot.days(from: date)
        let link = day.ride.map { RideLink(pick: $0.id).url } ?? URL(string: "rideon://ride")
        switch family {
        case .systemSmall: small(days).widgetURL(link)
        case .systemMedium: medium(days).widgetURL(link)
        case .systemLarge: large(days).widgetURL(link)
        case .systemExtraLarge: extraLarge(days)
        #if os(iOS)
        case .accessoryInline, .accessoryCircular, .accessoryRectangular:
            let best = snapshot.day(at: date, paged: nil) ?? day
            accessory(best).widgetURL(best.ride.map { RideLink(pick: $0.id).url })
        #endif
        default: small(days).widgetURL(link)
        }
    }

    private var units: RideWidgetSnapshot.Units { snapshot.units }
    private func isBest(_ day: RideWidgetSnapshot.Day) -> Bool { day.date == snapshot.bestDay }

    // MARK: Small

    private func small(_ days: [RideWidgetSnapshot.Day]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            MapPanel(ride: day.ride, shape: .band, units: units)
                .frame(height: 76)
                .overlay(alignment: .topLeading) { dayLabel.mapChip().padding(8) }
                .overlay(alignment: .topTrailing) { Pager(days: days, shown: day.date, onMap: true).padding(8) }
            VStack(alignment: .leading, spacing: 1) {
                if let ride = day.ride {
                    HStack {
                        Text(ride.start.clock).font(.system(size: 24, weight: .bold)).monospacedDigit()
                        Spacer(minLength: 4)
                        ScorePill(score: ride.score, meetsMinimums: ride.meetsMinimums, best: isBest(day))
                    }
                    Text("\(ride.name) · \(units.distance(ride.distanceKm))").font(.system(size: 12, weight: .semibold))
                    note(ride)
                } else {
                    noRide
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Spacer(minLength: 0)
        }
    }

    // MARK: Medium

    private func startLine(_ ride: RideWidgetSnapshot.Ride, finish: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(ride.start.clock).font(.system(size: 30, weight: .bold)).monospacedDigit()
            if finish { Text("→ ~\(ride.finish.clock)").font(.system(size: 13)).foregroundStyle(.secondary) }
            Spacer(minLength: 2)
            ScorePill(score: ride.score, meetsMinimums: ride.meetsMinimums, best: isBest(day))
        }
    }

    private func medium(_ days: [RideWidgetSnapshot.Day]) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 1) {
                HStack {
                    dayLabel.font(.system(size: 11, weight: .semibold)).foregroundStyle(.tint)
                    Spacer()
                    Pager(days: days, shown: day.date, onMap: false)
                }
                if let ride = day.ride {
                    // The finish gives way on narrow phones; the start never truncates.
                    ViewThatFits(in: .horizontal) { startLine(ride, finish: true); startLine(ride, finish: false) }
                    Text("\(ride.name) · \(units.distance(ride.distanceKm))").font(.system(size: 12, weight: .semibold))
                    note(ride)
                } else {
                    noRide
                }
                Spacer(minLength: 4)
                DayStrip(days: days, shown: day.date, best: snapshot.bestDay)
            }
            .lineLimit(1)
            .padding(12)
            MapPanel(ride: day.ride, shape: .tall, units: units)
                .frame(width: 148)
                .overlay(alignment: .topTrailing) { trackLink(day.ride).padding(6) }
        }
    }

    // MARK: Large

    private func large(_ days: [RideWidgetSnapshot.Day]) -> some View {
        VStack(spacing: 0) {
            MapPanel(ride: day.ride, shape: .band, units: units, hours: true)
                .frame(height: 176)
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 4) {
                        if isBest(day) { Image(systemName: "star.fill").foregroundStyle(.tint) }
                        if let ride = day.ride {
                            Text("\(ride.start.weekday) \(ride.start.clock) → ~\(ride.finish.clock) · \(ride.name)")
                            ScorePill(score: ride.score, meetsMinimums: ride.meetsMinimums, best: isBest(day))
                        } else {
                            Text(day.date.weekdayDay)
                        }
                    }
                    .lineLimit(1)
                    .mapChip()
                    .padding(8)
                }
                .overlay(alignment: .topTrailing) { trackLink(day.ride).padding(8) }
            board(days).padding(12)
            Spacer(minLength: 0)
        }
    }

    // MARK: Extra large

    /// Always the best ride, so the map doesn't change under a tap on a row.
    private func extraLarge(_ days: [RideWidgetSnapshot.Day]) -> some View {
        let best = days.first { isBest($0) } ?? days.first { $0.ride != nil } ?? day
        return HStack(spacing: 0) {
            MapPanel(ride: best.ride, shape: .square, units: units, hours: true)
                .overlay(alignment: .topLeading) {
                    Label(best.ride.map { "\($0.start.weekday) · \($0.name)" } ?? best.date.weekdayDay, systemImage: "star.fill")
                        .labelStyle(StarLabel())
                        .mapChip()
                        .padding(8)
                }
                .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 8) {
                header(days)
                if let ride = best.ride {
                    HStack {
                        Heading(text: "★ Best · \(ride.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)))", tint: .rideAccent)
                        Spacer()
                        trackLink(ride, onMap: false)
                    }
                    Link(destination: RideLink(pick: ride.id).url) { FlightRow(ride: ride, units: units) }
                    HStack(spacing: 6) {
                        ScorePill(score: ride.score, meetsMinimums: ride.meetsMinimums, best: true)
                        Text("\(units.temperatures(ride.temperatureC)) · \(ride.wind.title) \(units.wind(ride.windKph)) · \(ride.dry)")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                }
                Divider()
                rows(days)
                Spacer(minLength: 0)
            }
            .lineLimit(1)
            .padding(14)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: Lock Screen

    #if os(iOS)
    /// The best ride: no paging on the Lock Screen.
    @ViewBuilder
    private func accessory(_ best: RideWidgetSnapshot.Day) -> some View {
        if let ride = best.ride {
            let star = isBest(best) ? "★ " : ""
            switch family {
            case .accessoryInline:
                Text("\(star)\(ride.start.weekday) \(ride.start.clock) · \(ride.score) · \(ride.name)") // the name truncates, not the score
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text(ride.start.weekday.uppercased()).font(.system(size: 9, weight: .semibold))
                        Text(ride.start.clock).font(.system(size: 14, weight: .bold)).minimumScaleFactor(0.7)
                        Text("\(star)\(ride.score)").font(.system(size: 10, weight: .semibold)).widgetAccentable()
                    }
                }
            default:
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(star)\(ride.start.weekday) \(ride.start.clock) · \(ride.score)").font(.headline).widgetAccentable()
                    // The finish gives way before the name truncates.
                    ViewThatFits(in: .horizontal) { Text("\(ride.name) · back ~\(ride.finish.clock)"); Text(ride.name) }
                    Text(ride.meetsMinimums ? ride.note : "⚠ \(ride.note)").foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text(best.note ?? "No ride today")
        }
    }
    #endif

    // MARK: Parts

    private var dayLabel: some View {
        Label(day.date.weekdayDay.uppercased(), systemImage: "star.fill")
            .labelStyle(StarLabel(shown: isBest(day)))
    }

    @ViewBuilder
    private func note(_ ride: RideWidgetSnapshot.Ride) -> some View {
        if ride.meetsMinimums {
            Text(ride.note).font(.system(size: 11)).foregroundStyle(.secondary)
        } else {
            Label(ride.note, systemImage: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(.belowMinimums)
        }
    }

    private var noRide: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("No ride").font(.system(size: 18, weight: .bold))
            Text(day.note ?? "Nothing fits your minimums").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
        }
    }

    @ViewBuilder
    private func trackLink(_ ride: RideWidgetSnapshot.Ride?, onMap: Bool = true) -> some View {
        if let ride {
            Link(destination: RideLink(pick: ride.id, track: true).url) {
                Label("Track", systemImage: "bell")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tint)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(onMap ? AnyShapeStyle(.white) : AnyShapeStyle(Color.rideAccent.opacity(0.12)), in: .capsule)
            }
        }
    }

    private func header(_ days: [RideWidgetSnapshot.Day]) -> some View {
        HStack {
            if let first = days.first, let last = days.last {
                Heading(text: "Next \(days.count) days · \(first.date.weekdayDay) – \(last.date.weekdayDay)")
            }
            Spacer()
            Label("Updated \(snapshot.generatedAt.clock)", systemImage: "clock")
                .font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }

    private func board(_ days: [RideWidgetSnapshot.Day]) -> some View {
        VStack(spacing: 4) {
            header(days)
            rows(days)
        }
    }

    private func rows(_ days: [RideWidgetSnapshot.Day]) -> some View {
        VStack(spacing: 1) {
            ForEach(days.prefix(6), id: \.date) { row in
                BoardRow(day: row, selected: row.date == day.date, best: isBest(row), units: units)
            }
        }
    }
}

/// "★" before the label, in the accent, only on the best day.
private struct StarLabel: LabelStyle {
    var shown = true

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 3) {
            if shown { configuration.icon.foregroundStyle(.tint).imageScale(.small) }
            configuration.title
        }
    }
}

/// ‹ › — the previous and next day, dimmed at the ends.
private struct Pager: View {
    var days: [RideWidgetSnapshot.Day]
    var shown: Date
    var onMap: Bool

    var body: some View {
        let index = days.firstIndex { $0.date == shown } ?? 0
        HStack(spacing: 4) {
            page("chevron.left", to: index > 0 ? days[index - 1].date : nil)
            page("chevron.right", to: index + 1 < days.count ? days[index + 1].date : nil)
        }
    }

    private func page(_ symbol: String, to day: Date?) -> some View {
        Button(intent: PageDay(day: day ?? shown)) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(onMap ? AnyShapeStyle(.black) : AnyShapeStyle(.primary))
                .frame(width: 20, height: 20)
                .background(onMap ? AnyShapeStyle(.white) : AnyShapeStyle(.fill.tertiary), in: .circle)
        }
        .buttonStyle(.plain)
        .disabled(day == nil)
        .opacity(day == nil ? 0.4 : 1)
    }
}

/// The medium widget's days: weekday and score, the one shown tinted. A tap pages to it.
private struct DayStrip: View {
    var days: [RideWidgetSnapshot.Day]
    var shown: Date
    var best: Date?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(days.prefix(7), id: \.date) { day in
                Button(intent: PageDay(day: day.date)) {
                    VStack(spacing: 0) {
                        Text(day.date.weekday).font(.system(size: 9)).foregroundStyle(.secondary)
                        Text(day.ride.map { "\($0.score)" } ?? "–")
                            .font(.system(size: 12, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(day.ride?.meetsMinimums == false ? Color.belowMinimums : day.date == best ? .rideAccent : .primary)
                    }
                    .padding(.vertical, 2)
                    .frame(maxWidth: .infinity)
                    .background(day.date == shown ? AnyShapeStyle(Color.rideAccent.opacity(0.15)) : AnyShapeStyle(.clear),
                                in: .rect(cornerRadius: 5))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// One day of the board: a tap shows it on the map.
private struct BoardRow: View {
    var day: RideWidgetSnapshot.Day
    var selected: Bool
    var best: Bool
    var units: RideWidgetSnapshot.Units

    var body: some View {
        Button(intent: PageDay(day: day.date)) {
            HStack(spacing: 6) {
                Text(day.date.weekdayDay).fontWeight(.semibold).frame(width: 46, alignment: .leading)
                if let ride = day.ride {
                    Text(ride.start.clock).monospacedDigit().foregroundStyle(.secondary)
                    Text(ride.name)
                    Spacer(minLength: 2)
                    Text(units.temperatures(ride.temperatureC)).foregroundStyle(.secondary)
                    Image(systemName: ride.wind.systemImage).foregroundStyle(ride.wind.tint).imageScale(.small)
                    Image(systemName: ride.meetsMinimums ? ride.sky.systemImage : "exclamationmark.triangle.fill")
                        .foregroundStyle(ride.meetsMinimums ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.belowMinimums))
                        .imageScale(.small)
                        .frame(width: 16)
                    ScorePill(score: ride.score, meetsMinimums: ride.meetsMinimums, best: best)
                } else {
                    Text(day.note ?? "No ride").foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
            .font(.system(size: 12))
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2.5)
            .background(selected ? AnyShapeStyle(.fill.quaternary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}

/// The extra-large widget's best ride, as a flight board writes a departure: leave, the route, back.
private struct FlightRow: View {
    var ride: RideWidgetSnapshot.Ride
    var units: RideWidgetSnapshot.Units

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            end(ride.start.clock, "Leave", alignment: .leading)
            VStack(spacing: 3) {
                HStack(spacing: 4) {
                    Dash()
                    Image(systemName: "bicycle").font(.system(size: 11)).foregroundStyle(.secondary)
                    Dash()
                }
                .frame(height: 26)
                Text("\(ride.name) · \(units.distance(ride.distanceKm))").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            end("~\(ride.finish.clock)", "Back", alignment: .trailing)
        }
        .foregroundStyle(.primary)
    }

    private func end(_ time: String, _ label: String, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 3) {
            Text(time).font(.system(size: 22, weight: .bold)).monospacedDigit()
            Heading(text: label)
        }
    }
}

private struct Dash: View {
    var body: some View {
        Path { path in
            path.move(to: .zero)
            path.addLine(to: CGPoint(x: 400, y: 0))
        }
        .stroke(.tertiary, style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
        .frame(height: 1)
        .clipped()
    }
}

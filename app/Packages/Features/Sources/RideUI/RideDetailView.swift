import SwiftUI
import EventKit
import Models
import DesignSystem
import SharedUI
import Services

/// Ride detail (docs/redesign/README.md §2): one pick's verdict, departures, hourly forecast, route
/// profile and factor breakdown. Choosing a departure updates the forecast, the profile's wind
/// strip and the factors; the hero and verdict stay on the pick.
public struct RideDetailView: View {
    var board: RideBoard
    var pick: RideBoard.Pick
    var detail: RideDetail
    @State private var selection: Date
    @State private var titleOpacity = 0.0
    @State private var addedToCalendar: Date?
    @State private var calendarFailed = false
    @State private var elevation: [RideDetail.ElevationPoint]
    @Environment(\.services) private var services
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public init(board: RideBoard, pick: RideBoard.Pick) {
        self.board = board
        self.pick = pick
        // The fixture board carries no details; it keeps the sample.
        let detail = board.details[pick.id] ?? .sample(for: pick, on: board)
        self.detail = detail
        _elevation = State(initialValue: detail.elevation)
        _selection = State(initialValue: pick.start)
    }

    private var departure: RideDetail.Departure {
        detail.departures.first { $0.id == selection } ?? detail.departures[0]
    }

    private var eyebrow: String? {
        if pick.id == board.picks.first?.id { return "Best pick" }
        return board.days.contains { $0.best?.id == pick.id } ? "Best that day" : nil
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                RideHero(pick: pick, eyebrow: eyebrow, height: 400)

                Group {
                    verdictCard
                    RideSection("Departure") {
                        DeparturePicker(departures: detail.departures, selection: $selection)
                        footnote(departureFootnote)
                    }
                    RideSection("Forecast on the Ride") {
                        forecastCard
                        if departure.windBreakdown == nil, let windFrom = departure.windFrom {
                            footnote("Wind from the \(windFrom).")
                        }
                    }
                    if let sky = departure.sky {
                        RideSection("Sky on the Ride") {
                            SkyOnTheRide(sky: sky, start: departure.start, finish: departure.finish)
                        }
                    }
                    if let wind = departure.windBreakdown {
                        RideSection("Wind on the Ride") {
                            WindOnTheRide(wind: wind, coordinates: pick.route.coordinates,
                                          start: departure.start, finish: departure.finish)
                        }
                    }
                    if !elevation.isEmpty {
                        RideSection("Along the Route") {
                            RouteProfile(elevation: elevation, wind: departure.wind)
                                .padding(16)
                                .card()
                        }
                    }
                    RideSection("Why It Scored \(departure.score)") {
                        VStack(spacing: 20) {
                            ForEach(departure.factors.sorted { $0.score > $1.score }, id: \.name) { FactorRow($0) }
                        }
                        .padding(16)
                        .card()
                        footnote("Each factor is weighted by your preferences.")
                    }
                    actionsCard
                    footer
                }
                .padding(.horizontal, 16)
            }
            .padding(.bottom, 40)
        }
        .onScrollGeometryChange(for: Double.self) { geometry in
            // The inline title fades in as the hero's title block scrolls under the toolbar.
            min(1, max(0, (geometry.contentOffset.y + geometry.contentInsets.top - 290) / 40))
        } action: { _, opacity in
            titleOpacity = opacity
        }
        .ignoresSafeArea(edges: .top)
        .background(.groupedBackground)
        .navigationTitle(pick.route.name)
        .task {
            // ponytail: Open-Meteo per visit, no cache; cache by route id if it gets slow.
            guard elevation.isEmpty, !pick.route.coordinates.isEmpty else { return }
            elevation = (try? await RideBoardLoader.elevation(of: pick.route, using: services.elevation)) ?? []
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(pick.route.name)
                    .font(.headline)
                    .opacity(titleOpacity)
                    .accessibilityHidden(titleOpacity == 0)
            }
            .sharedBackgroundVisibility(.hidden)
            ToolbarItemGroup(placement: .primaryAction) {
                ShareLink(item: RouteGPX(route: pick.route), preview: SharePreview(pick.route.name)) {
                    Label("Send route to a bike computer", systemImage: "square.and.arrow.up")
                }
                Menu("More", systemImage: "ellipsis") {
                    calendarButton
                    cycleTravelLink
                }
            }
        }
        .alert("Couldn't add to Calendar", isPresented: $calendarFailed) {} message: {
            Text("Allow Ride On to add events in Settings › Privacy & Security › Calendars.")
        }
    }

    // MARK: Verdict

    private var verdictCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(spacing: 14))
            layout {
                ScoreGauge(score: pick.score, tint: pick.meetsMinimums ? .accentColor : .gray)
                VStack(alignment: .leading, spacing: 4) {
                    Verdict(meetsMinimums: pick.meetsMinimums)
                        .font(.headline)
                        .foregroundStyle(pick.meetsMinimums ? AnyShapeStyle(.tint) : AnyShapeStyle(.belowMinimums))
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        if let change = pick.change, change != 0 { ChangeBadge(change: change) }
                        Text(historyLine)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
            }

            if !detail.notes.isEmpty {
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(detail.notes, id: \.self) { note in
                        Label {
                            Text(note.text)
                        } icon: {
                            Image(systemName: icon(for: note.kind))
                                .foregroundStyle(.secondary)
                        }
                        .labelStyle(IconColumn())
                        .font(.subheadline)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// "since 07:00 · last ridden 29 Sep", after the change badge.
    private var historyLine: String {
        let since = pick.change == nil ? nil : detail.changeSince.map { "since \($0.formatted(.clockTime))" }
        let ridden = pick.lastRidden.map { "last ridden \($0.formatted(.dateTime.day().month(.abbreviated)))" }
        let line = [since, ridden].compactMap(\.self).joined(separator: " · ")
        return since == nil ? line.prefix(1).uppercased() + line.dropFirst() : line
    }

    private var departureFootnote: String {
        let others = detail.departures.count - 1
        guard others > 0 else { return "The best time in your window." }
        let count = NumberFormatter.localizedString(from: others as NSNumber, number: .spellOut)
        return "The best time, then the next \(count) in your window. Choosing one updates everything below."
    }

    // MARK: Forecast

    private var forecastCard: some View {
        let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout(alignment: .top, spacing: 0))
        return layout {
            ForEach(departure.hours) { hour in
                forecastHour(hour)
            }
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// A column per hour; at accessibility sizes a row per hour whose values wrap.
    private func forecastHour(_ hour: RideDetail.Hour) -> some View {
        let isLarge = dynamicTypeSize.isAccessibilitySize
        let layout = isLarge ? AnyLayout(FlowLayout(spacing: 12)) : AnyLayout(VStackLayout(spacing: 6))
        let time = hour.time.formatted(.clockTime)
        let wind = UnitFormat.speed(kph: hour.windKph, system: speedSystem)
        let rain = (hour.rainChance).formatted(.percent.precision(.fractionLength(0)))
        return layout {
            Text(time).font(.subheadline).foregroundStyle(.secondary)
            Image(systemName: hour.sky.outlineSymbol)
                .symbolRenderingMode(.multicolor)
                .font(.title3)
            Text(UnitFormat.degrees(c: hour.temperatureC, locale: locale)).font(.title2.weight(.semibold))
            Text(wind).font(.subheadline)
            Text("Gusts \(speedValue(hour.gustKph))").font(.footnote).foregroundStyle(.secondary)
            Label(rain, systemImage: "drop.fill")
                .labelStyle(.titleAndIcon)
                .imageScale(.small)
                .font(.footnote)
                .foregroundStyle(.rain)
        }
        .monospacedDigit()
        .padding(.horizontal, isLarge ? 10 : 0)
        .frame(maxWidth: .infinity, alignment: isLarge ? .leading : .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(time), \(hour.sky.title), \(UnitFormat.degrees(c: hour.temperatureC, locale: locale)), wind \(wind), gusts \(UnitFormat.speed(kph: hour.gustKph, system: speedSystem)), \(rain) chance of rain")
    }

    /// "24": the gust number alone, in the rider's units, as Weather writes it under the wind.
    private func speedValue(_ kph: Double) -> Int {
        let speed = Measurement(value: kph, unit: UnitSpeed.kilometersPerHour)
        return Int(speed.converted(to: speedSystem == .metric ? .kilometersPerHour : .milesPerHour).value.rounded())
    }

    // MARK: Actions

    private var actionsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            calendarButton
                .padding(.vertical, 14)
            if pick.route.cycleTravelURL != nil {
                Divider()
                cycleTravelLink
                    .padding(.vertical, 14)
            }
        }
        .padding(.horizontal, 16)
        .card()
    }

    private var calendarButton: some View {
        let added = addedToCalendar == departure.id
        let day = departure.start.formatted(.dateTime.weekday(.abbreviated))
        let times = "\(day) \(departure.start.formatted(.clockTime))–\(departure.finish.formatted(.clockTime))"
        return Button {
            Task { await addToCalendar(departure) }
        } label: {
            ViewThatFits(in: .horizontal) {
                HStack {
                    Label(added ? "Added to Calendar" : "Add to Calendar", systemImage: added ? "checkmark" : "calendar.badge.plus").labelStyle(IconColumn())
                    Spacer()
                    Text(times).foregroundStyle(Color.secondary).monospacedDigit()
                }
                VStack(alignment: .leading, spacing: 2) {
                    Label(added ? "Added to Calendar" : "Add to Calendar", systemImage: added ? "checkmark" : "calendar.badge.plus").labelStyle(IconColumn())
                    Text(times).foregroundStyle(Color.secondary).monospacedDigit()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .disabled(added)
        .accessibilityValue(times)
    }

    @ViewBuilder
    private var cycleTravelLink: some View {
        if let url = pick.route.cycleTravelURL {
            Link(destination: url) {
                Label("Open in cycle.travel", systemImage: "arrow.up.forward.square")
                    .labelStyle(IconColumn())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
        }
    }

    /// Write-only access: Ride On never reads the rider's calendar.
    private func addToCalendar(_ departure: RideDetail.Departure) async {
        let store = EKEventStore()
        do {
            guard try await store.requestWriteOnlyAccessToEvents() else {
                calendarFailed = true
                return
            }
            let event = EKEvent(eventStore: store)
            event.title = "Ride: \(pick.route.name)"
            event.startDate = departure.start
            event.endDate = departure.finish
            event.url = pick.route.cycleTravelURL
            event.calendar = store.defaultCalendarForNewEvents
            try store.save(event, span: .thisEvent)
            withAnimation(.smooth) { addedToCalendar = departure.id }
        } catch {
            calendarFailed = true
        }
    }

    // MARK: Chrome

    private func icon(for kind: RideDetail.Note.Kind) -> String {
        switch kind {
        case .temperature: "thermometer.medium"
        case .wind: "wind"
        case .rain: "drop"
        case .other: "info.circle"
        }
    }

    private func footnote(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            WeatherAttributionFooter(board.credits)
            Text("Updated \(board.generatedAt.formatted(.clockTime)).")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

/// Icons in a fixed-width column, so the titles of stacked labels line up.
struct IconColumn: LabelStyle {
    @ScaledMetric(relativeTo: .body) private var width = 26.0

    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            configuration.icon.frame(width: width)
            configuration.title
        }
    }
}

extension RideBoard.Sky {
    /// Weather's outline symbols, drawn multicolour in the forecast grid and the Ride Window sheet.
    var outlineSymbol: String {
        switch self {
        case .sunny: "sun.max"
        case .sunnySpells: "cloud.sun"
        case .cloudy: "cloud"
        case .rain: "cloud.rain"
        }
    }
}

#Preview {
    NavigationStack {
        RideDetailView(board: .sample, pick: RideBoard.sample.picks[0])
    }
}

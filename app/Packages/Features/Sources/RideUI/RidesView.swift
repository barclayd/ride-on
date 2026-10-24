import SwiftUI
import UniformTypeIdentifiers
import Models
import Engine
import Services
import DesignSystem
import SharedUI

/// The Rides tab (docs/redesign/README.md §1): the window's best ride as a hero, its conditions,
/// the window's days, then every other tracked route.
public struct RidesView: View {
    var board: RideBoard
    var refreshStatus: String?
    var previousPlan: Bool
    var refresh: @MainActor @Sendable () async -> Void
    var apply: @MainActor @Sendable (RideWindow) async -> Void
    @State private var selectedDay: Date
    @State private var choosingWindow = false
    /// The ride the Track sheet is open for.
    @State private var tracking: RideBoard.Pick?
    /// The tracked ride's `Pick.id` as the bell shows it: it follows `RideTracker` once the sheet has gone.
    @State private var shownTracked: String?
    @Namespace private var zoom
    @Environment(RideTracker.self) private var tracker: RideTracker?
    @Environment(RideRequest.self) private var request: RideRequest?
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    /// `apply` reloads Rides for a window chosen in the Ride Window sheet.
    // ponytail: the fixture world's default `apply` does nothing, so Done there only closes the sheet.
    public init(board: RideBoard, refresh: @escaping @MainActor @Sendable () async -> Void = {},
                apply: @escaping @MainActor @Sendable (RideWindow) async -> Void = { _ in },
                refreshStatus: String? = nil, previousPlan: Bool = false) {
        self.board = board
        self.refreshStatus = refreshStatus
        self.previousPlan = previousPlan
        self.refresh = refresh
        self.apply = apply
        let bestDay = board.days.first { $0.best?.id == board.picks.first?.id } ?? board.days.first
        _selectedDay = State(initialValue: bestDay?.date ?? board.window.start)
    }

    /// The selected day's best ride; the window's best when nothing is selected.
    private var hero: RideBoard.Pick? {
        board.days.first { $0.date == selectedDay }?.best ?? board.picks.first
    }

    public var body: some View {
        ScrollView {
            // ponytail: no picks is the Window passed screen, built with the Ride Window sheet (PR 4);
            // LiveRidesView covers it with an empty state meanwhile.
            if let hero {
                VStack(spacing: 16) {
                    ZStack(alignment: .bottomTrailing) {
                        NavigationLink(value: hero) {
                            RideHero(pick: hero, eyebrow: previousPlan ? "Previous pick" : hero.id == board.picks.first?.id ? "Best pick" : "Best that day")
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .matchedTransitionSource(id: hero.id, in: zoom)

                        // Beside the link, not inside it, so VoiceOver reaches both.
                        // ponytail: a tracked ride that isn't the hero has no bell to show it.
                        if shownTracked == hero.id || tracker?.canTrack(trackable(hero)) ?? true {
                            trackButton(hero)
                                .padding(.trailing, 20)
                                .padding(.bottom, 38)
                        }
                    }

                    Group {
                        if let refreshStatus {
                            Text(refreshStatus)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityIdentifier("rides.refreshStatus")
                        }
                        conditionsCard(hero)
                        RideSection("Your Window") { windowCard }
                        let others = board.picks.filter { $0.route.id != hero.route.id }
                        if !others.isEmpty {
                            RideSection("Other Tracked Routes") { rows(others, content: pickRow) }
                        }
                        if !board.unfit.isEmpty {
                            RideSection("Doesn't Fit Your Window") { rows(board.unfit, content: unfitRow) }
                        }
                        footer
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 140)
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(.groupedBackground)
        // Titled for the detail's back button; the hero is the visible title.
        .navigationTitle("Rides")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar(removing: .title)
        .navigationDestination(for: RideBoard.Pick.self) { pick in
            let current = board.details[pick.id]?.pick ?? pick
            RideDetailView(board: board, pick: current, previousPlan: previousPlan)
                .zoomTransition(from: pick.id, in: zoom)
        }
        .refreshable { await refresh() }
        .onChange(of: board.days.map(\.date)) { _, dates in
            if !dates.contains(selectedDay) {
                selectedDay = board.days.first { $0.best?.id == board.picks.first?.id }?.date ?? dates.first ?? board.window.start
            }
        }
        .sheet(isPresented: $choosingWindow) { RideWindowSheet(board: board, apply: apply) }
        // The bell changes once the sheet has gone, so the change is seen.
        .sheet(item: $tracking, onDismiss: showTracked) { pick in
            TrackRideSheet(pick: pick, isTracking: shownTracked == pick.id, replacing: replacing(pick))
        }
        .onAppear { shownTracked = tracker?.ride?.pickID }
        .onChange(of: request?.pickID, initial: true) { _, id in
            guard let id, let request else { return }
            let track = request.track
            request.pickID = nil
            guard let pick = (board.picks + board.days.compactMap(\.best)).first(where: { $0.id == id }) else { return }
            if let day = board.days.first(where: { $0.best?.id == id }) ?? board.days.first(where: { Calendar.current.isDate($0.date, inSameDayAs: pick.start) }) {
                selectedDay = day.date
            }
            if track { tracking = trackable(pick) }
        }
        .onChange(of: tracker?.ride?.pickID) { if tracking == nil { showTracked() } }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { choosingWindow = true } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                        Text(windowTitle).monospacedDigit()
                        Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold))
                    }
                }
                .accessibilityLabel("Ride window, \(windowTitle)")
            }
            ToolbarItem(placement: .primaryAction) {
                // ponytail: no-op until tracking a route is redesigned.
                Button("Track a route", systemImage: "plus") {}
            }
        }
    }

    private func showTracked() {
        guard shownTracked != tracker?.ride?.pickID else { return }
        withAnimation(Motion.glassTapLayout) { shownTracked = tracker?.ride?.pickID }
    }

    /// The window's ranking of the same ride: its recommendation compares the whole window, where a
    /// day's best only compares that day.
    private func trackable(_ pick: RideBoard.Pick) -> RideBoard.Pick {
        board.picks.first { $0.id == pick.id } ?? pick
    }

    /// The other tracked ride that tracking `pick` stops, if there is one.
    private func replacing(_ pick: RideBoard.Pick) -> String? {
        guard let ride = tracker?.ride, ride.pickID != pick.id else { return nil }
        let name = (board.picks + board.days.compactMap(\.best)).first { $0.route.id == ride.routeId }?.route.name
        let when = "\(ride.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))), \(ride.start.formatted(.clockTime))"
        return [name, when].compactMap(\.self).joined(separator: " · ")
    }

    /// Opens the Track sheet for the hero's ride; gold glass while it's tracked.
    private func trackButton(_ pick: RideBoard.Pick) -> some View {
        let isOn = shownTracked == pick.id
        let day = pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return Button {
            tracking = trackable(pick)
        } label: {
            Image(systemName: isOn ? "bell.fill" : "bell")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: isOn)
                .padding(8)
                .frame(minWidth: 48, minHeight: 48)
                .glassEffect(isOn ? .clear.tint(.committed).interactive() : .clear.interactive(), in: .circle)
                .shadow(color: isOn ? Color.committed.opacity(0.45) : .clear, radius: 8, y: 4)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(trigger: isOn) { _, on in on ? .success : .selection }
        .accessibilityLabel(isOn ? "Tracking \(pick.route.name) on \(day)" : "Track \(pick.route.name) on \(day)")
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier("track-bell")
    }

    // MARK: Conditions

    /// The ride's day and times, flight-board style: leave, how long, back.
    private func planHeader(_ pick: RideBoard.Pick) -> some View {
        let date = pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))
        let leave = pick.start.formatted(.clockTime)
        let back = pick.finish.formatted(.clockTime)
        let length = pick.finish.timeIntervalSince(pick.start)
        let spoken = Duration.seconds(length).formatted(.units(allowed: [.hours, .minutes], width: .wide))
        let duration = "About \(Self.hoursMinutes(length))"
        let dash = Dash().stroke(.tertiary, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])).frame(minWidth: 12, maxHeight: 2)
        return VStack(alignment: .leading, spacing: 8) {
            Text(date).font(.subheadline.weight(.semibold))
            ViewThatFits(in: .horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 0) {
                    GridRow {
                        Text(leave)
                        HStack(spacing: 6) {
                            dash
                            Image(systemName: "bicycle").font(.body).foregroundStyle(.tint)
                            dash
                        }
                        .gridColumnAlignment(.center)
                        Text("~\(back)").gridColumnAlignment(.trailing)
                    }
                    .font(.title.bold())
                    GridRow {
                        Text("Leave")
                        Text(duration)
                        Text("Back")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(leave) → ~\(back)").font(.title.bold())
                    Text(duration).font(.footnote).foregroundStyle(.secondary)
                }
            }
            .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(date). Leave \(leave), about \(spoken), back about \(back).")
    }

    private func conditionsCard(_ pick: RideBoard.Pick) -> some View {
        let conditions = pick.conditions
        return VStack(alignment: .leading, spacing: 14) {
            planHeader(pick)
            Divider()
            let verdict = Group {
                if previousPlan { Label("From your saved forecast", systemImage: "clock") }
                else { Verdict(meetsMinimums: pick.meetsMinimums) }
            }
            let lastRidden = pick.lastRidden.map {
                Text("Last ridden \($0.formatted(.dateTime.day().month(.abbreviated)))")
                    .font(.footnote.weight(.regular))
                    .foregroundStyle(Color.secondary)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) { verdict; Spacer(); lastRidden }
                VStack(alignment: .leading, spacing: 4) { verdict; lastRidden }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(pick.meetsMinimums ? AnyShapeStyle(.tint) : AnyShapeStyle(.belowMinimums))

            FlowLayout {
                ConditionChip(UnitFormat.temperatureRange(c: conditions.temperatureC, locale: locale), systemImage: "thermometer.medium", tint: .orange)
                ConditionChip("\(UnitFormat.speed(kph: conditions.windKph, system: speedSystem)) \(conditions.wind.rawValue)", systemImage: "wind", tint: .blue)
                ConditionChip("Gusts \(UnitFormat.speed(kph: conditions.gustKph, system: speedSystem))")
                ConditionChip(conditions.sky.title, systemImage: conditions.sky.systemImage, tint: conditions.sky.tint)
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                let title = Text("Conditions").font(.subheadline.weight(.semibold))
                let score = HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if let change = pick.change, change != 0 { ChangeBadge(change: change) }
                    Text("\(Text("\(pick.score)").font(.title2.bold()))\(Text("/100").font(.footnote.weight(.medium)).foregroundStyle(.secondary))")
                        .monospacedDigit()
                        .accessibilityLabel("\(pick.score) out of 100")
                }
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline) { title; Spacer(); score }
                    VStack(alignment: .leading, spacing: 4) { title; score }
                }
                ProgressView(value: Double(pick.score), total: 100)
                    .tint(pick.meetsMinimums ? Color.accentColor : .gray)
                    .accessibilityHidden(true)
            }
        }
        .padding(.top, 16)
        .padding([.horizontal, .bottom], 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    // MARK: Window

    private var windowCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            DayStrip(days: board.days, selection: $selectedDay)
            Text(windowFootnote)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
        }
        .padding([.horizontal, .top], 10)
        .padding(.bottom, 12)
        .card()
    }

    private var windowTitle: String {
        let last = board.window.end.addingTimeInterval(-1)
        let style = Date.FormatStyle.dateTime.weekday(.abbreviated).day()
        return "\(board.window.start.formatted(style)) – \(last.formatted(style))"
    }

    private var windowFootnote: String {
        let washouts = board.days.filter { $0.best == nil && $0.sky == .rain }
            .map { "\($0.date.formatted(.dateTime.weekday(.wide))) has rain from dawn to dusk." }
        return (["Best ride each day."] + washouts).joined(separator: " ")
    }

    // MARK: Rows

    private func rows<Item: Identifiable, Row: View>(_ items: [Item], @ViewBuilder content: @escaping (Item) -> Row) -> some View {
        VStack(spacing: 0) {
            ForEach(items) { item in
                if item.id != items.first?.id {
                    Divider().padding(.leading, 80)
                }
                content(item)
                    .padding(.vertical, 12)
                    .padding(.leading, 12)
                    .padding(.trailing, 16)
            }
        }
        .card()
    }

    private func pickRow(_ pick: RideBoard.Pick) -> some View {
        let day = pick.start.formatted(.dateTime.weekday(.abbreviated))
        let start = pick.start.formatted(.clockTime)
        let finish = pick.finish.formatted(.clockTime)
        let distance = UnitFormat.distance(km: pick.route.distanceKm, system: unitSystem, fractionDigits: 0)
        return NavigationLink(value: pick) {
            row(pick.route, tint: pick.meetsMinimums ? .accentColor : .gray) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(pick.route.name).font(.headline)
                    Text("\(day) \(start) → ~\(finish) · \(distance)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    if pick.meetsMinimums || previousPlan {
                        Text("\(UnitFormat.temperatureRange(c: pick.conditions.temperatureC, locale: locale)) · \(pick.conditions.wind.title) · \(pick.conditions.sky.title)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        Label("Below your minimums", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.belowMinimums)
                    }
                }
            } trailing: {
                Text(pick.score, format: .number)
                    .font(.title3.bold())
                    .monospacedDigit()
                    .foregroundStyle(pick.meetsMinimums ? .primary : .tertiary)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: pick.id, in: zoom)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("rides-route-row")
    }

    private func unfitRow(_ unfit: RideBoard.Unfit) -> some View {
        let distance = UnitFormat.distance(km: unfit.route.distanceKm, system: unitSystem, fractionDigits: 0)
        return row(unfit.route, tint: .gray) {
            VStack(alignment: .leading, spacing: 1) {
                Text(unfit.route.name).font(.headline)
                Text("\(distance) · about \(Self.hoursMinutes(unfit.rideDuration)). Your window allows \(Self.hoursMinutes(unfit.windowAllows)).")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        } trailing: {}
        .accessibilityElement(children: .combine)
    }

    /// Thumbnail, text, trailing score. At accessibility sizes the text drops below the
    /// thumbnail so it gets the card's full width (DESIGN-SYSTEM.md §8).
    @ViewBuilder
    private func row(_ route: RideBoard.RouteSummary, tint: Color, @ViewBuilder text: () -> some View, @ViewBuilder trailing: () -> some View) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    thumbnail(route, tint: tint)
                    Spacer(minLength: 0)
                    trailing()
                }
                text()
            }
        } else {
            HStack(spacing: 12) {
                thumbnail(route, tint: tint)
                text()
                Spacer(minLength: 0)
                trailing()
            }
        }
    }

    private func thumbnail(_ route: RideBoard.RouteSummary, tint: Color) -> some View {
        RouteMap(route.coordinates, style: .thumbnail, tint: tint)
            .frame(width: 56, height: 56)
            .clipShape(.rect(cornerRadius: 12))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    /// "7h 05m": `Duration.UnitsFormatStyle` can't zero-pad minutes alone.
    private static func hoursMinutes(_ interval: TimeInterval) -> String {
        let minutes = Int(interval / 60)
        return "\(minutes / 60)h " + String(format: "%02dm", minutes % 60)
    }

    // MARK: Chrome

    private var updatedTime: String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: board.timeZone) ?? .current
        var format = calendar.isDateInToday(board.generatedAt)
            ? Date.FormatStyle.dateTime.hour().minute()
            : Date.FormatStyle.dateTime.day().month(.abbreviated).hour().minute()
        format.timeZone = calendar.timeZone
        return board.generatedAt.formatted(format)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            WeatherAttributionFooter(board.credits)
            Text("Updated \(updatedTime). Pull down to refresh.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

private extension RideBoard.Sky {
    var tint: Color {
        switch self {
        case .sunny, .sunnySpells: .yellow
        case .cloudy: .secondary
        case .rain: .rain
        }
    }
}

// MARK: - Shared with Ride detail

/// A titled group of cards.
struct RideSection<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.title3.bold())
                .padding(.horizontal, 4)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)
            content
        }
    }
}

/// "✓ Meets your preferences" or "⚠ Below your minimums"; the caller sets font and colour.
struct Verdict: View {
    var meetsMinimums: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if meetsMinimums {
                Image(systemName: "checkmark")
                Text("Meets your preferences")
            } else {
                Image(systemName: "exclamationmark.triangle.fill")
                Text("Below your minimums")
            }
        }
    }
}

/// "▲ 4": how far the score moved with the latest forecast.
struct ChangeBadge: View {
    var change: Int

    var body: some View {
        Text("\(change > 0 ? "▲" : "▼") \(abs(change))")
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(.tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(.tint.opacity(0.15), in: .capsule)
            .accessibilityLabel("\(change > 0 ? "Up" : "Down") \(abs(change)) since the last forecast")
    }
}

private extension View {
    /// Ride detail zooms out of the hero or row it opened from (iOS; macOS pushes).
    @ViewBuilder
    func zoomTransition(from id: some Hashable, in namespace: Namespace.ID) -> some View {
        #if os(iOS)
        navigationTransition(.zoom(sourceID: id, in: namespace))
        #else
        self
        #endif
    }
}

/// The share item: the route as a GPX file a bike computer app can import.
/// A horizontal line through the middle of its frame, for dashed strokes.
private struct Dash: Shape {
    func path(in rect: CGRect) -> Path {
        Path { $0.move(to: CGPoint(x: rect.minX, y: rect.midY)); $0.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)) }
    }
}

struct RouteGPX: Transferable {
    var route: RideBoard.RouteSummary

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: UTType(importedAs: "com.topografix.gpx")) { gpx in
            GPXWriter.data(name: gpx.route.name, coordinates: gpx.route.coordinates)
        }
        .suggestedFileName { "\($0.route.name).gpx" }
    }
}

#Preview {
    NavigationStack {
        RidesView(board: .sample)
    }
    .environment(RideTracker(live: false))
}

/// A widget tap (docs/redesign/README.md §8): Rides shows the ride's day, and with `track` opens its
/// Track sheet. The app sets it from `rideon://ride`; Rides clears it once handled.
@MainActor @Observable
public final class RideRequest {
    public var pickID: String?
    public var track = false

    public init() {}

    public func open(_ pickID: String, track: Bool) {
        self.track = track
        self.pickID = pickID
    }
}

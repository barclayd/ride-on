import SwiftUI
import UniformTypeIdentifiers
import Models
import Engine
import Services
import DesignSystem
import SharedUI

/// The Rides tab (docs/redesign/README.md §1): the window's best ride as a hero, its conditions,
/// the window's days, then every other tracked route. Its layout follows the space it's given
/// (DESIGN-SYSTEM.md §5, iPhone Duo): one column, two columns standing in a tent, a grid on the
/// open phone in portrait, and Rides beside the open ride on the open phone in landscape.
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
    /// The ride someone opened: beside Rides when they're side by side, pushed over it otherwise.
    @State private var opened: RideBoard.Pick?
    /// `opened` while Rides has the screen to itself.
    @State private var pushed: RideBoard.Pick?
    /// The ride beside Rides has the whole screen (Full Screen; Show Rides gives it back).
    @State private var fullScreen = false
    /// Where each opened ride's detail is, so it comes back as it was when the phone opens or closes.
    @State private var states = RideDetailStates()
    @Namespace private var zoom
    @Environment(RideTracker.self) private var tracker: RideTracker?
    @Environment(RideRequest.self) private var request: RideRequest?
    @Environment(\.paneShape) private var paneShape
    #if os(iOS)
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    #endif
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

    /// The Mac and iPad keep the one-column layout.
    private var shape: PaneShape { paneShape ?? .narrow }

    /// Rides and a ride side by side: the open phone in landscape.
    private var isSplit: Bool { shape == .wide }

    /// The ride shown beside Rides: the one opened, or the hero until one is.
    private var shown: RideBoard.Pick? { opened ?? hero }

    /// The ride whose detail is beside Rides, marked where Rides lists it.
    private var selectedID: RideBoard.Pick.ID? { isSplit && !fullScreen ? shown?.id : nil }

    public var body: some View {
        layout
            .background(.groupedBackground)
            // Titled for the detail's back button; the hero is the visible title.
            .navigationTitle("Rides")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar(removing: .title)
            .navigationDestination(item: $pushed) { pick in
                detail(pick)
                    .zoomTransition(from: pick.id, in: zoom)
            }
            // Opening or closing the phone moves the open ride between the pane and the stack,
            // without a push or a pop: it was already on screen.
            .onChange(of: isSplit) { _, split in
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    if split {
                        pushed = nil
                    } else {
                        fullScreen = false
                        pushed = opened
                    }
                }
            }
            // Back from the pushed ride closes it, so opening the phone shows Rides' own pick.
            .onChange(of: pushed) { _, pick in
                if pick == nil && !isSplit { opened = nil }
            }
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
                // Beside Rides, the requested day's best ride takes the pane.
                if isSplit { opened = nil }
                if track { tracking = trackable(pick) }
            }
            .onChange(of: tracker?.ride?.pickID) { if tracking == nil { showTracked() } }
            .toolbar { toolbarItems }
    }

    /// Opens a ride: beside Rides when there's room, pushed otherwise.
    private func open(_ pick: RideBoard.Pick) {
        opened = pick
        if !isSplit { pushed = pick }
    }

    private func detail(_ pick: RideBoard.Pick, fullScreen: Binding<Bool>? = nil) -> some View {
        RideDetailView(board: board, pick: board.details[pick.id]?.pick ?? pick, previousPlan: previousPlan,
                       state: states.state(for: pick, on: board), fullScreen: fullScreen)
    }

    @ViewBuilder private var layout: some View {
        switch shape {
        case .narrow: column
        case .tent: tent
        case .portrait: portrait
        case .wide: split
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder private var toolbarItems: some ToolbarContent {
        // Side by side, the rail belongs to the ride; Rides' buttons are in its pane bar.
        if !isSplit {
            #if os(iOS)
            if toolbarVerticalEdge != nil {
                // On the rail: symbols only, and the create action at the bottom, by the thumb.
                ToolbarItem(placement: .navigation) { rideWindowButton }
                ToolbarItem(placement: .bottomBar) { trackRouteButton }
            } else {
                ToolbarItem(placement: .navigation) { windowCapsule }
                ToolbarItem(placement: .primaryAction) { trackRouteButton }
            }
            #else
            ToolbarItem(placement: .navigation) { windowCapsule }
            ToolbarItem(placement: .primaryAction) { trackRouteButton }
            #endif
        }
    }

    private var windowCapsule: some View {
        Button { choosingWindow = true } label: {
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                Text(windowTitle).monospacedDigit()
                Image(systemName: "chevron.up.chevron.down").font(.caption.weight(.semibold))
            }
        }
        .accessibilityLabel("Ride window, \(windowTitle)")
    }

    private var rideWindowButton: some View {
        Button("Ride Window", systemImage: "calendar") { choosingWindow = true }
            .accessibilityValue(windowTitle)
    }

    private var trackRouteButton: some View {
        // ponytail: no-op until tracking a route is redesigned.
        Button("Track a Route", systemImage: "plus") {}
    }

    // MARK: Layouts

    /// One column, under the hero's map: the closed phone, any other iPhone in portrait, the Mac.
    private var column: some View {
        ScrollView {
            // ponytail: no picks is the Window passed screen, built with the Ride Window sheet (PR 4);
            // LiveRidesView covers it with an empty state meanwhile.
            if let hero {
                VStack(spacing: 16) {
                    ZStack(alignment: .bottomTrailing) {
                        Button { open(hero) } label: {
                            RideHero(pick: hero, eyebrow: eyebrow(hero))
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .matchedTransitionSource(id: hero.id, in: zoom)

                        // Beside the link, not inside it, so VoiceOver reaches both.
                        // ponytail: a tracked ride that isn't the hero has no bell to show it.
                        if showsBell(hero) {
                            trackButton(hero, onMap: true)
                                .padding(.trailing, 20)
                                .padding(.bottom, 38)
                        }
                    }

                    Group {
                        status
                        conditionsCard(hero)
                        windowSection
                        othersSection(hero)
                        unfitSection
                        footer
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 140)
            }
        }
        .ignoresSafeArea(edges: .top)
        .refreshable { await refresh() }
    }

    /// Standing in a tent: read at arm's length, so two columns with the score big and nothing
    /// to scroll for but the other routes (iPhone Duo's tent pose; any iPhone in landscape).
    private var tent: some View {
        ScrollView {
            if let hero {
                VStack(alignment: .leading, spacing: 14) {
                    status
                    HStack(alignment: .top, spacing: 16) {
                        heroCard(hero, style: .tent)
                            .frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: 14) {
                            windowSection
                            othersSection(hero)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    // WeatherKit's attribution stays, below the fold.
                    footer
                }
                .padding(.top, 14)
                .padding(.leading, 18)
                .padding(.trailing, 16)
                .padding(.bottom, 20)
            }
        }
        .refreshable { await refresh() }
    }

    /// The open phone in portrait: the hero across the top, then two columns.
    private var portrait: some View {
        ScrollView {
            if let hero {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Rides")
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                        .padding(.horizontal, 4)
                    status
                    heroCard(hero, style: .banner)
                    HStack(alignment: .top, spacing: 20) {
                        VStack(alignment: .leading, spacing: 16) {
                            windowSection
                            unfitSection
                        }
                        .frame(maxWidth: .infinity)
                        othersSection(hero)
                            .frame(maxWidth: .infinity)
                    }
                    footer
                }
                .padding(.top, 8)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
        .refreshable { await refresh() }
    }

    /// The open phone in landscape: Rides on the leading half, up to the fold, with the ride it
    /// opened beside it. Full Screen gives the ride Rides' half too.
    private var split: some View {
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            let full = proxy.size.width + insets.leading + insets.trailing
            let ridesWidth = (full / 2).rounded(.down) - insets.leading
            ZStack(alignment: .trailing) {
                ridesPane
                    .frame(width: ridesWidth)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .opacity(fullScreen ? 0 : 1)
                    .allowsHitTesting(!fullScreen)
                    .accessibilityHidden(fullScreen)
                if let shown {
                    detail(shown, fullScreen: $fullScreen)
                        .id(shown.id)
                        .frame(width: fullScreen ? proxy.size.width : proxy.size.width - ridesWidth)
                }
            }
        }
        #if os(iOS)
        // The rail keeps the ride's actions however Rides scrolls.
        .toolbarMinimizationBehavior(.never, for: .navigationBar)
        #endif
    }

    /// Rides beside the open ride: its own bar on top, since the rail belongs to the ride.
    private var ridesPane: some View {
        ScrollView {
            if let hero {
                VStack(alignment: .leading, spacing: 16) {
                    status
                    heroCard(hero, style: .column)
                    windowSection
                    othersSection(hero)
                    unfitSection
                    footer
                }
                .padding(.top, 4)
                .padding(.leading, 20)
                .padding(.trailing, 16)
                .padding(.bottom, 28)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
        .safeAreaBar(edge: .top) {
            PaneBar("Rides") {
                rideWindowButton
                trackRouteButton
            }
        }
        .refreshable { await refresh() }
    }

    // MARK: Sections

    @ViewBuilder private var status: some View {
        if let refreshStatus {
            Text(refreshStatus)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("rides.refreshStatus")
        }
    }

    private var windowSection: some View {
        RideSection("Your Window") { windowCard }
    }

    @ViewBuilder private func othersSection(_ hero: RideBoard.Pick) -> some View {
        let others = board.picks.filter { $0.route.id != hero.route.id }
        if !others.isEmpty {
            RideSection("Other Tracked Routes") { rows(others, selected: selectedID, content: pickRow) }
        }
    }

    @ViewBuilder private var unfitSection: some View {
        if !board.unfit.isEmpty {
            RideSection("Doesn't Fit Your Window") { rows(board.unfit, content: unfitRow) }
        }
    }

    private func eyebrow(_ pick: RideBoard.Pick) -> String {
        previousPlan ? "Previous pick" : pick.id == board.picks.first?.id ? "Best pick" : "Best that day"
    }

    /// Whether the hero shows its bell: it can be tracked, or it already is.
    private func showsBell(_ pick: RideBoard.Pick) -> Bool {
        shownTracked == pick.id || tracker?.canTrack(trackable(pick)) ?? true
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

    /// Opens the Track sheet for the hero's ride. Over the hero's map it's clear glass, gold while
    /// the ride is tracked; on a card it's a filled circle, gold while tracked.
    private func trackButton(_ pick: RideBoard.Pick, onMap: Bool) -> some View {
        let isOn = shownTracked == pick.id
        let day = pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return Button {
            tracking = trackable(pick)
        } label: {
            Image(systemName: isOn ? "bell.fill" : "bell")
                .font(.title3.weight(.semibold))
                .foregroundStyle(onMap || isOn ? AnyShapeStyle(.white) : AnyShapeStyle(.tint))
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: isOn)
                .padding(8)
                .frame(minWidth: 48, minHeight: 48)
                .modifier(BellBackground(onMap: onMap, isOn: isOn))
        }
        .buttonStyle(.plain)
        .sensoryFeedback(trigger: isOn) { _, on in on ? .success : .selection }
        .accessibilityLabel(isOn ? "Tracking \(pick.route.name) on \(day)" : "Track \(pick.route.name) on \(day)")
        .accessibilityAddTraits(isOn ? .isSelected : [])
        .accessibilityIdentifier("track-bell")
    }

    // MARK: Hero card

    enum HeroCardStyle {
        /// Name and score, the route's map, then the conditions: beside the open ride.
        case column
        /// No map, a bigger score: standing in a tent.
        case tent
        /// The text beside the route's map: across the open phone in portrait.
        case banner
    }

    /// The best ride as a card, where Rides has no room for (or no need of) the full-bleed hero.
    private func heroCard(_ pick: RideBoard.Pick, style: HeroCardStyle) -> some View {
        let isSelected = selectedID == pick.id
        let bell = showsBell(pick)
        return Button { open(pick) } label: {
            heroCardContent(pick, style: style, bellRoom: bell)
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
                .clipShape(.rect(cornerRadius: 26))
                .contentShape(.rect(cornerRadius: 26))
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: pick.id, in: zoom)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier("rides-hero")
        // The bell in the corner of the card's text, so never on the banner's light map, where
        // clear glass would lose its white glyph.
        .overlay {
            if bell {
                HStack(spacing: 0) {
                    trackButton(pick, onMap: false)
                        .padding(12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    if style == .banner {
                        Color.clear.allowsHitTesting(false)
                    }
                }
            }
        }
        // The ride beside Rides: ringed in the accent, outside the card.
        .background {
            RoundedRectangle(cornerRadius: 28.5)
                .fill(.tint)
                .padding(-2.5)
                .opacity(isSelected ? 1 : 0)
        }
    }

    @ViewBuilder
    private func heroCardContent(_ pick: RideBoard.Pick, style: HeroCardStyle, bellRoom: Bool) -> some View {
        let tint: Color = pick.meetsMinimums ? .accentColor : .gray
        let kickerLabel = HStack(spacing: 4) {
            Image(systemName: "star.fill")
                .font(.caption2.weight(.bold))
                .imageScale(.small)
            Text(kicker(pick, short: style == .tent))
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.tint)
        let nameLabel = Text(pick.route.name)
            .font(.title.bold())
            .fixedSize(horizontal: false, vertical: true)
        let metaLabel = Text(meta(pick))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)

        let header = Group {
            if style != .column {
                // Half a display: only the name shares a line with the score.
                VStack(alignment: .leading, spacing: 4) {
                    kickerLabel
                    HStack(spacing: 12) {
                        nameLabel
                        Spacer(minLength: 0)
                        ScoreGauge(score: pick.score, tint: tint, size: style == .tent ? 92 : 64)
                    }
                    metaLabel
                }
                .padding([.horizontal, .top], 16)
                .padding(.bottom, 12)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        kickerLabel
                        nameLabel
                        metaLabel
                    }
                    Spacer(minLength: 0)
                    ScoreGauge(score: pick.score, tint: tint, size: 64)
                }
                .padding([.horizontal, .top], 16)
                .padding(.bottom, 12)
            }
        }

        let conditions = Group {
            if style != .column {
                // The chips get the card's width; the verdict shares the bell's row.
                VStack(alignment: .leading, spacing: 10) {
                    heroChips(pick)
                        .padding(.trailing, 16)
                    meetsLine(pick)
                        .padding(.trailing, bellRoom ? 72 : 16)
                        .frame(minHeight: bellRoom ? 48 : 0, alignment: .leading)
                }
                .padding(.leading, 16)
                .padding(.bottom, bellRoom ? 12 : 14)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    heroChips(pick)
                    meetsLine(pick)
                }
                .padding(.top, 12)
                .padding(.leading, 16)
                // Clear of the bell in the card's corner.
                .padding(.trailing, bellRoom ? 72 : 16)
                .padding(.bottom, 14)
                .frame(minHeight: bellRoom ? 72 : 0, alignment: .top)
            }
        }

        let thumb = RouteMap(pick.route.coordinates, style: .card, tint: tint)
            .id(pick.route.coordinates)
            .allowsHitTesting(false)
            .accessibilityHidden(true)

        switch style {
        case .column:
            VStack(alignment: .leading, spacing: 0) {
                header
                thumb.aspectRatio(386 / 236, contentMode: .fit)
                conditions
            }
        case .tent:
            VStack(alignment: .leading, spacing: 0) {
                header
                conditions
            }
        case .banner:
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    conditions
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                thumb
                    .frame(maxWidth: .infinity, minHeight: 236, maxHeight: .infinity)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// "Best pick · Wednesday 14 October"; standing in a tent, just the weekday.
    private func kicker(_ pick: RideBoard.Pick, short: Bool) -> String {
        let day = short
            ? pick.start.formatted(.dateTime.weekday(.wide))
            : pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return "\(eyebrow(pick)) · \(day)"
    }

    /// "09:00 → ~12:00 · 51 km · 640 m".
    private func meta(_ pick: RideBoard.Pick) -> String {
        let start = pick.start.formatted(.clockTime)
        let finish = pick.finish.formatted(.clockTime)
        let distance = UnitFormat.distance(km: pick.route.distanceKm, system: unitSystem, fractionDigits: 0)
        let climb = UnitFormat.elevation(m: pick.route.ascentM, system: unitSystem)
        return "\(start) → ~\(finish) · \(distance) · \(climb)"
    }

    private func heroChips(_ pick: RideBoard.Pick) -> some View {
        let conditions = pick.conditions
        return FlowLayout {
            ConditionChip(UnitFormat.temperatureRange(c: conditions.temperatureC, locale: locale), systemImage: "thermometer.medium", tint: .orange)
            ConditionChip("\(UnitFormat.speed(kph: conditions.windKph, system: speedSystem)) \(conditions.wind.rawValue)", systemImage: "wind", tint: .blue)
            ConditionChip("Gusts \(UnitFormat.speed(kph: conditions.gustKph, system: speedSystem))")
            ConditionChip(conditions.sky.title, systemImage: conditions.sky.systemImage, tint: conditions.sky.tint)
        }
    }

    /// "Meets your preferences · Last ridden 29 Sep · ▲ 4".
    private func meetsLine(_ pick: RideBoard.Pick) -> some View {
        let verdict = previousPlan ? "From your saved forecast"
            : pick.meetsMinimums ? "Meets your preferences" : "Below your minimums"
        var line = Text(verdict)
            .foregroundStyle(pick.meetsMinimums || previousPlan ? AnyShapeStyle(.secondary) : AnyShapeStyle(.belowMinimums))
        if let ridden = pick.lastRidden {
            line = Text("\(line) · Last ridden \(ridden.formatted(.dateTime.day().month(.abbreviated)))")
        }
        if let change = pick.change, change != 0 {
            let badge = Text("\(change > 0 ? "▲" : "▼") \(abs(change))")
                .fontWeight(.semibold)
                .foregroundStyle(.tint)
                .accessibilityLabel("\(change > 0 ? "up" : "down") \(abs(change)) since the last forecast")
            line = Text("\(line) · \(badge)")
        }
        return line
            .font(.footnote)
            .foregroundStyle(.secondary)
            .monospacedDigit()
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
                .fixedSize(horizontal: false, vertical: true)
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

    /// `selected` is the row whose ride is open beside Rides.
    private func rows<Item: Identifiable, Row: View>(_ items: [Item], selected: Item.ID? = nil, @ViewBuilder content: @escaping (Item) -> Row) -> some View {
        VStack(spacing: 0) {
            ForEach(items) { item in
                if item.id != items.first?.id {
                    Divider().padding(.leading, 80)
                }
                content(item)
                    .padding(.vertical, 12)
                    .padding(.leading, 12)
                    .padding(.trailing, 16)
                    .background(item.id == selected ? AnyShapeStyle(.tint.opacity(0.14)) : AnyShapeStyle(.clear))
                    .accessibilityAddTraits(item.id == selected ? .isSelected : [])
            }
        }
        .card()
        .clipShape(.rect(cornerRadius: 26))
    }

    private func pickRow(_ pick: RideBoard.Pick) -> some View {
        let day = pick.start.formatted(.dateTime.weekday(.abbreviated))
        let start = pick.start.formatted(.clockTime)
        let finish = pick.finish.formatted(.clockTime)
        let distance = UnitFormat.distance(km: pick.route.distanceKm, system: unitSystem, fractionDigits: 0)
        return Button { open(pick) } label: {
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

extension RideBoard.Sky {
    /// The sky chip's symbol colour (Rides cards, ride detail's header).
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

/// The track bell's circle: clear glass over the hero's map (a control on the map, §2), a solid
/// fill on a card, where glass would be on content. Gold while the ride is tracked.
private struct BellBackground: ViewModifier {
    var onMap: Bool
    var isOn: Bool

    func body(content: Content) -> some View {
        if onMap {
            content
                .glassEffect(isOn ? .clear.tint(.committed).interactive() : .clear.interactive(), in: .circle)
                .shadow(color: isOn ? Color.committed.opacity(0.45) : .clear, radius: 8, y: 4)
        } else {
            content
                .background(isOn ? AnyShapeStyle(Color.committed) : AnyShapeStyle(.fill.tertiary), in: .circle)
        }
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

// The iPhone Duo's poses beside the rail (PaneShape), for the canvas: the simulator can't fold.
#Preview("Tent", traits: .fixedLayout(width: 606, height: 466)) {
    NavigationStack { RidesView(board: .sample) }
        .measuresPaneShape()
        .environment(RideTracker(live: false))
}

#Preview("Open, landscape", traits: .fixedLayout(width: 879, height: 669)) {
    NavigationStack { RidesView(board: .sample) }
        .measuresPaneShape()
        .environment(RideTracker(live: false))
}

#Preview("Open, portrait", traits: .fixedLayout(width: 669, height: 951)) {
    NavigationStack { RidesView(board: .sample) }
        .measuresPaneShape()
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

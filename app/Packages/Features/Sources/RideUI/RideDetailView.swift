import SwiftUI
import MapKit
import EventKit
import Models
import DesignSystem
import SharedUI
import Services

/// Ride detail (docs/redesign/README.md §2): the route's map fills the screen and a floating panel
/// carries the rest. The panel's header follows the chosen departure (when, how far, the score and
/// its conditions) and stays put when the panel is collapsed to show the map. Below it: the verdict,
/// the departures, Along the Route (its scrubbing pins the point on the map), the forecast, the sky,
/// the wind (which can colour the route on the map), the factors and the actions.
///
/// On an iPhone Duo it takes the shape it's given (DESIGN-SYSTEM.md §5): the floating panel when
/// narrow, a 380pt column beside the map when wide, a 310pt column with the score at display size
/// in tent, and the map above a two-column panel in open portrait.
public struct RideDetailView: View {
    var incomingBoard: RideBoard
    var suppliedPreviousPlan: Bool
    var pick: RideBoard.Pick
    /// Beside Rides on an open iPhone Duo: whether the ride has the whole screen. Nil when pushed.
    var fullScreen: Binding<Bool>?
    @State private var state: RideDetailState
    private var savedBoard: RideBoard { state.savedBoard }
    private var board: RideBoard { incomingBoard.details[pick.id] == nil ? savedBoard : incomingBoard }
    private var previousPlan: Bool {
        suppliedPreviousPlan || (incomingBoard.details[pick.id] == nil && savedBoard.details[pick.id] != nil)
    }
    private var detail: RideDetail { board.details[pick.id] ?? .sample(for: pick, on: board) }
    private var selection: Date {
        get { state.selection }
        nonmutating set { state.selection = newValue }
    }
    private var addedToCalendar: Date? {
        get { state.addedToCalendar }
        nonmutating set { state.addedToCalendar = newValue }
    }
    private var elevation: [RideDetail.ElevationPoint] {
        get { state.elevation }
        nonmutating set { state.elevation = newValue }
    }
    private var detent: PanelDetent {
        get { state.detent }
        nonmutating set { state.detent = newValue }
    }
    private var showsWind: Bool {
        get { state.showsWind }
        nonmutating set { state.showsWind = newValue }
    }
    private var scrubKm: Double? {
        get { state.scrubKm }
        nonmutating set { state.scrubKm = newValue }
    }
    @State private var calendarFailed = false
    /// Whether the panel floats with its detents, for Show Wind on Map.
    @State private var floating = false
    @State private var headerHeight: CGFloat = 0
    @State private var windKeyHeight: CGFloat = 0
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @Environment(\.paneShape) private var paneShape
    @Environment(\.services) private var services
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.locale) private var locale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.self) private var environment

    /// `state` carries the ride across presentations (Rides keeps one per pick); without it the
    /// view keeps its own.
    public init(board: RideBoard, pick: RideBoard.Pick, previousPlan: Bool = false, state: RideDetailState? = nil,
                fullScreen: Binding<Bool>? = nil) {
        self.incomingBoard = board
        self.suppliedPreviousPlan = previousPlan
        self.pick = pick
        self.fullScreen = fullScreen
        _state = State(initialValue: state ?? RideDetailState(board: board, pick: pick))
    }

    private var departure: RideDetail.Departure {
        detail.departures.first { $0.id == selection } ?? detail.departures[0]
    }

    /// The pick's own departure: the verdict, eyebrow and change speak for it alone.
    private var isPickDeparture: Bool { departure.id == pick.start }

    private var eyebrow: String? {
        if previousPlan { return "Previous pick" }
        if pick.id == board.picks.first?.id { return "Best pick" }
        return board.days.contains { $0.best?.id == pick.id } ? "Best that day" : nil
    }

    public var body: some View {
        GeometryReader { proxy in
            let safeArea = proxy.safeAreaInsets
            let layout = layout(in: proxy.size)
            Group {
            switch layout {
            case .floating:
                // The panel sits 8pt off the screen's bottom edge; large reaches 8pt under the
                // navigation bar and medium leaves the top 42% for the map.
                let large = max(proxy.size.height + safeArea.bottom - 16, 0)
                let medium = (large * 0.58).rounded()
                // Collapsed frames the route over everything but the header; medium and large
                // frame it above medium, so opening the panel all the way doesn't squeeze the map.
                let covered = detent == .collapsed ? min(headerHeight + 20, medium) : medium
                ZStack(alignment: .bottom) {
                    map(padding: EdgeInsets(top: safeArea.top + 8 + keyInset, leading: safeArea.leading,
                                            bottom: 16 + covered, trailing: safeArea.trailing))
                    mapOverlays
                        .padding(.top, 8)
                        .padding(.horizontal, 16)
                        .opacity(detent == .large ? 0 : 1)
                    panel(heights: medium...large, bottomInset: safeArea.bottom)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 8)
                        .ignoresSafeArea(.container, edges: .bottom)
                }
            case .side(let width):
                // The panel is a column the map's height; the route frames beside it.
                ZStack(alignment: .topLeading) {
                    map(padding: EdgeInsets(top: safeArea.top + 8 + keyInset, leading: safeArea.leading + 8 + width + 8,
                                            bottom: safeArea.bottom + 8, trailing: safeArea.trailing + 8))
                    mapOverlays
                        .padding(.top, 8)
                        .padding(.leading, width + 16)
                        .padding(.trailing, 16)
                    panel(heights: nil, bottomInset: 0)
                        .frame(width: width)
                        .padding(8)
                }
            case .portrait:
                // The map takes the top half of the screen and the panel the bottom, in two columns.
                let full = proxy.size.height + safeArea.top + safeArea.bottom
                let panelTop = (full / 2).rounded() + 8 - safeArea.top
                let panelHeight = max(proxy.size.height - 8 - panelTop, 0)
                ZStack(alignment: .bottom) {
                    map(padding: EdgeInsets(top: safeArea.top + 8 + keyInset, leading: safeArea.leading + 8,
                                            bottom: safeArea.bottom + 8 + panelHeight + 16, trailing: safeArea.trailing + 8))
                    mapOverlays
                        .padding(.top, 8)
                        .padding(.horizontal, 16)
                    panel(heights: nil, bottomInset: 0, columns: true)
                        .frame(height: panelHeight)
                        .padding(.horizontal, 8)
                        .padding(.bottom, 8)
                }
            }
            }
            .onChange(of: layout == .floating, initial: true) { floating = $1 }
        }
        .onChange(of: incomingBoard) { _, latest in
            if latest.details[pick.id] != nil { state.savedBoard = latest }
        }
        .onChange(of: selection) { scrubKm = nil }
        .modifier(DetailChrome(title: pick.route.name, pushed: fullScreen == nil))
        .task(id: pick.route.coordinates) {
            // Route changes invalidate the old elevation; unchanged geometry keeps it on screen.
            guard detail.elevation.isEmpty, !pick.route.coordinates.isEmpty else { return }
            elevation = []
            let points = (try? await RideBoardLoader.elevation(of: pick.route, using: services.elevation)) ?? []
            guard !Task.isCancelled else { return }
            elevation = points
        }
        .toolbar { toolbarItems }
        .alert("Couldn't add to Calendar", isPresented: $calendarFailed) {} message: {
            Text("Allow Ride On to add events in Settings › Privacy & Security › Calendars.")
        }
    }

    // MARK: Layout

    private enum Layout: Equatable {
        /// The panel floats over the map with its detents.
        case floating
        /// The panel is a column beside the map: 380pt, or 310pt in tent.
        case side(width: CGFloat)
        /// Open portrait: the map above, the panel below in two columns.
        case portrait
    }

    /// iPhone lays out by the shape the ride is given (an iPhone Duo's half pane is narrow, its
    /// full screen wide); iPad and the Mac by size class.
    private func layout(in size: CGSize) -> Layout {
        if paneShape != nil {
            return switch PaneShape(size) {
            case .narrow: .floating
            case .tent: .side(width: Self.tentPanelWidth)
            case .portrait: .portrait
            case .wide: .side(width: Self.sidePanelWidth)
            }
        }
        #if os(iOS)
        return horizontalSizeClass == .compact ? .floating : .side(width: Self.sidePanelWidth)
        #else
        return .side(width: Self.sidePanelWidth)
        #endif
    }

    /// Tent: the ride standing on a desk, where the score is the number that matters.
    private var isTent: Bool { paneShape == .tent }

    private static let sidePanelWidth: CGFloat = 380
    private static let tentPanelWidth: CGFloat = 310

    /// The wind's key and the gap under it, so the route frames below the key rather than under it.
    private var keyInset: CGFloat { windShown == nil ? 0 : windKeyHeight + 8 }

    // MARK: Toolbar

    /// Pushed: Send to a Bike Computer, then "…" (Add to Calendar, Open in cycle.travel). Beside
    /// Rides on an open iPhone Duo, Full Screen (or Show Rides) comes first.
    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        if let fullScreen {
            ToolbarItem(placement: .primaryAction) {
                let isFull = fullScreen.wrappedValue
                Button(isFull ? "Show Rides" : "Full Screen",
                       systemImage: isFull ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                    withAnimation(Motion.paneResize) { fullScreen.wrappedValue.toggle() }
                }
            }
            .visibilityPriority(.high)
        }
        ToolbarItem(placement: .primaryAction) {
            ShareLink(item: RouteGPX(route: pick.route), preview: SharePreview(pick.route.name)) {
                Label("Send to a Bike Computer", systemImage: "square.and.arrow.up")
            }
            .disabled(pick.route.coordinates.count < 2)
        }
        .visibilityPriority(.high)
        #if os(iOS)
        ToolbarOverflowMenu {
            calendarButton
            cycleTravelLink
        }
        #else
        ToolbarItem(placement: .primaryAction) {
            Menu("More", systemImage: "ellipsis") {
                calendarButton
                cycleTravelLink
            }
        }
        #endif
    }

    // MARK: Map

    /// The departure's wind, when its stretches are placed along the route.
    private var mapWind: RideDetail.WindBreakdown? {
        guard let wind = departure.windBreakdown, wind.exact, pick.route.coordinates.count > 1 else { return nil }
        return wind
    }

    private var windShown: RideDetail.WindBreakdown? { showsWind ? mapWind : nil }

    /// The wind's runs along the route in their effects' colours.
    private var windRuns: [WindRun] {
        guard let wind = windShown else { return [] }
        let trace = RouteTrace(pick.route.coordinates)
        return wind.runs.map { WindRun(coordinates: trace.slice($0.from, $0.to), color: $0.effect.tint) }
    }

    private struct WindRun: Hashable {
        var coordinates: [Coordinate]
        var color: Color
    }

    /// The scrubbed point on the route, with "18 km · 142 m" for its callout.
    private var scrubPoint: (coordinate: Coordinate, label: String)? {
        guard let km = scrubKm, pick.route.coordinates.count > 1 else { return nil }
        let total = elevation.last?.km ?? pick.route.distanceKm
        guard total > 0 else { return nil }
        let coordinate = RouteTrace(pick.route.coordinates).at(min(1, max(0, km / total)))
        let label = [UnitFormat.distance(km: km, system: unitSystem, fractionDigits: 0),
                     elevationPoint(at: km).map { UnitFormat.elevation(m: $0.metres, system: unitSystem) }]
            .compactMap(\.self).joined(separator: " · ")
        return (coordinate, label)
    }

    private func elevationPoint(at km: Double) -> RideDetail.ElevationPoint? {
        elevation.min { abs($0.km - km) < abs($1.km - km) }
    }

    private func map(padding: EdgeInsets) -> some View {
        routeMap
            .safeAreaPadding(padding)
            .ignoresSafeArea()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Map of \(pick.route.name)")
            .accessibilityValue(windShown?.journey(along: pick.route.coordinates) ?? "")
            .accessibilityAddTraits(.isImage)
            #if os(iOS)
            .overlay(alignment: .top) {
                // Softens the map under the status bar and the bar's glass buttons, in the map's
                // own paper colour.
                LinearGradient(colors: [Color(red: 238 / 255, green: 242 / 255, blue: 225 / 255).opacity(0.92), .clear],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: 64)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
            #endif
    }

    #if os(iOS)
    private var routeMap: some View {
        let coordinates = pick.route.coordinates
        return CycleMap(lines: [],
                        selected: coordinates.count > 1 ? CycleMap.Line(id: pick.route.id, coordinates: coordinates) : nil,
                        stretches: windRuns.map { CycleMap.Stretch(coordinates: $0.coordinates, color: $0.color) },
                        pin: scrubPoint.map { CycleMap.Pin(coordinate: $0.coordinate, label: $0.label) },
                        camera: state.camera,
                        moved: { state.camera = .rect($0) })
    }
    #else
    private var routeMap: some View {
        let accent = Color.accentColor.resolve(in: environment)
        let locations = pick.route.coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        // A polyline keeps its first stroke, so the resolved colours are part of each one's identity.
        let runs = windRuns.map { WindRun(coordinates: $0.coordinates, color: Color($0.color.resolve(in: environment))) }
        return Map(position: $state.position) {
            if let start = locations.first, locations.count > 1 {
                ForEach([SelectedKey(id: pick.route.id, accent: accent)], id: \.self) { _ in
                    MapPolyline(coordinates: locations)
                        .stroke(.white, style: Self.line(9.5))
                    MapPolyline(coordinates: locations)
                        .stroke(Color(accent), style: Self.line(5.5))
                }
                ForEach(runs, id: \.self) { run in
                    MapPolyline(coordinates: run.coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) })
                        .stroke(run.color, style: Self.line(5.5))
                }
                Annotation("Start", coordinate: start, anchor: .center) {
                    Circle()
                        .fill(.white)
                        .stroke(.black.opacity(0.25), lineWidth: 1)
                        .frame(width: 20, height: 20)
                        .overlay { Circle().fill(Color(accent)).frame(width: 10, height: 10) }
                        .accessibilityHidden(true)
                }
                .annotationTitles(.hidden)
            }
            if let scrub = scrubPoint {
                Annotation(scrub.label, coordinate: CLLocationCoordinate2D(latitude: scrub.coordinate.latitude, longitude: scrub.coordinate.longitude),
                           anchor: .bottom) {
                    RoutePin(scrub.label)
                        .offset(y: RoutePin.anchor)
                        .tint(Color(accent))
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        // Light like the cycle map on iOS, so the same chrome sits over it.
        .environment(\.colorScheme, .light)
    }

    private static func line(_ width: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
    }

    private struct SelectedKey: Hashable {
        var id: UUID
        var accent: Color.Resolved
    }
    #endif

    /// Wind on the Ride's button, when the wind can be placed on the route.
    private var windOnMapAction: (() -> Void)? {
        mapWind == nil ? nil : { showWindOnMap() }
    }

    /// Frames the whole route again.
    private func fit() { state.fit(pick.route) }

    /// From Wind on the Ride: the wind on the route, the panel out of its way and the whole route
    /// in view.
    private func showWindOnMap() {
        withAnimation(Motion.panelDetent()) {
            showsWind = true
            if floating { detent = .collapsed }
            fit()
        }
    }

    // MARK: Map chrome

    /// The wind's key at the top leading corner, the map's controls at the top trailing one.
    private var mapOverlays: some View {
        HStack(alignment: .top) {
            if let wind = windShown {
                WindKey(title: wind.from.isEmpty ? "Light wind" : "Wind from the \(wind.from.joined(separator: ", then "))",
                        rows: windKeyRows(wind))
                    .dynamicTypeSize(...DynamicTypeSize.xLarge)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { windKeyHeight = $0 }
                    .transition(.opacity)
            }
            Spacer(minLength: 16)
            mapControls
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// Wind and Fit, stacked in glass: regular and held light over the light map, like Routes'.
    private var mapControls: some View {
        VStack(spacing: 0) {
            if mapWind != nil {
                Button {
                    withAnimation(Motion.panelMaterialize) { showsWind.toggle() }
                } label: {
                    Image(systemName: "wind")
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(showsWind ? Color.accentColor : .primary)
                .accessibilityLabel("Wind on the map")
                .accessibilityAddTraits(showsWind ? .isSelected : [])
                Rectangle()
                    .fill(Color.primary.opacity(0.2))
                    .frame(height: 0.5)
                    .padding(.horizontal, 9)
                    .accessibilityHidden(true)
            }
            Button {
                withAnimation(Motion.panelMaterialize) { fit() }
            } label: {
                Image(systemName: "viewfinder")
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show the whole route")
        }
        .frame(width: 44)
        .font(.title3)
        // Chrome over the map, held at a fixed size like MapKit's own controls; long-press
        // shows the large content viewer instead.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityShowsLargeContentViewer()
        .foregroundStyle(Color.primary)
        .accessibleGlass(.regular.interactive(), in: .capsule, fallback: .white)
        .environment(\.colorScheme, .light)
    }

    /// The runs of at least 5% of the ride, in order; with more than four, each effect's share instead.
    private func windKeyRows(_ wind: RideDetail.WindBreakdown) -> [(effect: RideDetail.WindBreakdown.Effect, detail: String)] {
        let runs = wind.runs.filter { $0.to - $0.from >= 0.05 }
        guard runs.count <= 4 else {
            return wind.legend.map { ($0.effect, "~\(Int(($0.share * 20).rounded()) * 5)%") }
        }
        return runs.enumerated().map { index, run in
            let distance = UnitFormat.distance(km: (run.to - run.from) * pick.route.distanceKm, system: unitSystem, fractionDigits: 0)
            let position = runs.count == 1 ? "All the way" : index == 0 ? "First \(distance)" : index == runs.count - 1 ? "Last \(distance)" : "Next \(distance)"
            return (run.effect, position)
        }
    }

    // MARK: Panel

    /// The ride's panel; `columns` splits its content in two (open portrait).
    private func panel(heights: ClosedRange<CGFloat>?, bottomInset: CGFloat, columns: Bool = false) -> some View {
        FloatingPanel(pick.route.name, detent: $state.detent, heights: heights, scrollOffset: $state.scrollY) {
            header
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { headerHeight = $0 }
                .contentShape(.rect)
                .onTapGesture {
                    if detent == .collapsed, heights != nil {
                        withAnimation(Motion.panelDetent()) { detent = .medium }
                    }
                }
        } content: {
            content(columns: columns)
                .padding(.bottom, bottomInset)
        }
    }

    /// The departure at a glance, pinned at the panel's top: it's all that shows when collapsed.
    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            let layout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            layout {
                VStack(alignment: .leading, spacing: 4) {
                    eyebrowLine
                    Text(pick.route.name)
                        .font(.title.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(metaLine)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ScoreGauge(score: departure.score, tint: departure.score >= 70 ? .accentColor : .belowMinimums, size: isTent ? 92 : 64)
            }
            ScrollView(.horizontal) {
                HStack(spacing: 6) { chips }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 14)
    }

    @ViewBuilder
    private var eyebrowLine: some View {
        let day = departure.start.formatted(.dateTime.weekday(.wide).day().month(.wide))
        Group {
            if isPickDeparture, let eyebrow {
                Label("\(eyebrow) · \(day)", systemImage: previousPlan ? "clock" : "star.fill")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(previousPlan ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
            } else {
                Text(day).foregroundStyle(.tertiary)
            }
        }
        .font(.footnote.weight(.semibold))
    }

    /// "08:00 → ~10:45 · 52 km · 640 m".
    private var metaLine: String {
        let distance = UnitFormat.distance(km: pick.route.distanceKm, system: unitSystem, fractionDigits: 0)
        let ascent = UnitFormat.elevation(m: pick.route.ascentM, system: unitSystem)
        return "\(departure.start.formatted(.clockTime)) → ~\(departure.finish.formatted(.clockTime)) · \(distance) · \(ascent)"
    }

    /// Temperature, wind, sky and rain for the chosen departure; the pick's own match its card on Rides.
    @ViewBuilder
    private var chips: some View {
        let hours = departure.hours
        let conditions = isPickDeparture ? pick.conditions : nil
        let temperatures = hours.map(\.temperatureC)
        if let range = conditions?.temperatureC ?? temperatures.min().flatMap({ low in temperatures.max().map { low...$0 } }) {
            ConditionChip(UnitFormat.temperatureRange(c: range, locale: locale), systemImage: "thermometer.medium", tint: .orange)
        }
        if let kph = conditions?.windKph ?? (hours.isEmpty ? nil : hours.map(\.windKph).reduce(0, +) / Double(hours.count)) {
            let felt = conditions?.wind ?? departure.wind.max { $0.endKm - $0.startKm < $1.endKm - $1.startKm }?.wind
            ConditionChip([UnitFormat.speed(kph: kph, system: speedSystem), felt?.rawValue].compactMap(\.self).joined(separator: " "),
                          systemImage: "wind", tint: .blue)
        }
        if let sky = conditions?.sky ?? mostCommonSky(hours) {
            ConditionChip(sky.title, systemImage: sky.systemImage, tint: sky.tint)
        }
        if let rain = hours.map(\.rainChance).max() {
            ConditionChip(rain < 0.05 ? "Dry" : "\(rain.formatted(.percent.precision(.fractionLength(0)))) rain",
                          systemImage: "drop.fill", tint: .rain)
        }
    }

    private func mostCommonSky(_ hours: [RideDetail.Hour]) -> RideBoard.Sky? {
        let counts = Dictionary(hours.map { ($0.sky, 1) }, uniquingKeysWith: +)
        return hours.first { counts[$0.sky] == counts.values.max() }?.sky
    }

    // MARK: Content

    /// One column, or in open portrait the plan (verdict, departure, route, forecast) beside the
    /// conditions (sky, wind, the factors) and the actions.
    private func content(columns: Bool) -> some View {
        Group {
            if columns && !dynamicTypeSize.isAccessibilitySize {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 16) { planSections }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 16) { conditionSections }
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    planSections
                    conditionSections
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    @ViewBuilder
    private var planSections: some View {
            if previousPlan {
                Label("From your saved forecast. Update Rides for current conditions.", systemImage: "clock")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            verdictCard
            RideSection("Departure") {
                DeparturePicker(departures: detail.departures, selection: $state.selection)
                footnote(departureFootnote)
            }
            if !elevation.isEmpty {
                RideSection("Along the Route") {
                    VStack(alignment: .leading, spacing: 10) {
                        scrubReadout
                        RouteProfile(elevation: elevation, wind: departure.wind, selection: $state.scrubKm)
                    }
                    .padding(16)
                    .card()
                }
            }
            RideSection("Forecast on the Ride") {
                forecastCard
                if departure.windBreakdown == nil, let windFrom = departure.windFrom {
                    footnote("Wind from the \(windFrom).")
                }
            }
    }

    @ViewBuilder
    private var conditionSections: some View {
            if let sky = departure.sky {
                RideSection("Sky on the Ride") {
                    SkyOnTheRide(sky: sky, start: departure.start, finish: departure.finish)
                }
            }
            if let wind = departure.windBreakdown {
                RideSection("Wind on the Ride") {
                    WindOnTheRide(wind: wind, start: departure.start, finish: departure.finish, showOnMap: windOnMapAction)
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

    /// The scrubbed point's distance, height and felt wind, or how to scrub; one line either way, so
    /// the chart doesn't jump.
    private var scrubReadout: some View {
        let km = scrubKm
        let felt = km.flatMap { km in departure.wind.first { km >= $0.startKm && km <= $0.endKm }?.wind.title }
        let point = km.map { km in
            [UnitFormat.distance(km: km, system: unitSystem, fractionDigits: 0),
             elevationPoint(at: km).map { UnitFormat.elevation(m: $0.metres, system: unitSystem) }, felt]
                .compactMap(\.self).joined(separator: " · ")
        }
        return ZStack(alignment: .leading) {
            Text("Drag across the profile to find a point on the map.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .opacity(point == nil ? 1 : 0)
            Text(point ?? " ")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.tint)
                .monospacedDigit()
                .opacity(point == nil ? 0 : 1)
        }
        .accessibilityHidden(point == nil)
    }

    // MARK: Verdict

    private var verdictCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                if previousPlan {
                    Label("From your saved forecast", systemImage: "clock")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                } else {
                    verdict
                }
                let change = isPickDeparture ? pick.change.flatMap { $0 == 0 ? nil : $0 } : nil
                let history = isPickDeparture ? historyLine : ""
                if change != nil || !history.isEmpty {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        if let change { ChangeBadge(change: change) }
                        Text(history)
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

    /// The pick's own minimums, then the departure's score in three tiers.
    private var verdict: some View {
        let (symbol, text, style): (String, String, AnyShapeStyle) =
            if isPickDeparture && !pick.meetsMinimums {
                ("exclamationmark.triangle.fill", "Below your minimums", AnyShapeStyle(.belowMinimums))
            } else if departure.score >= 80 {
                ("checkmark.circle.fill", "Meets your preferences", AnyShapeStyle(.tint))
            } else if departure.score >= 70 {
                ("checkmark.circle", "Mostly meets your preferences", AnyShapeStyle(.primary))
            } else {
                ("exclamationmark.triangle.fill", "Misses some of your preferences", AnyShapeStyle(.belowMinimums))
            }
        return Label {
            Text(text).foregroundStyle(style)
        } icon: {
            Image(systemName: symbol).foregroundStyle(text.hasPrefix("Mostly") ? AnyShapeStyle(.tint) : style)
        }
        .font(.headline)
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
        return "The best time, then the next \(count) in your window. Choosing one updates everything here."
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

/// The wind on the map's key: "Wind from the south-west" over each run of the route's colours,
/// "Tailwind  First 32 km". White and light like the map under it, held at a fixed size like the
/// map's controls.
private struct WindKey: View {
    var title: String
    var rows: [(effect: RideDetail.WindBreakdown.Effect, detail: String)]
    @ScaledMetric(relativeTo: .caption) private var width = 200.0

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(row.effect.tint)
                        .frame(width: 16, height: 4)
                    Text(row.effect.title)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.detail)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .fixedSize()
                }
                .font(.caption)
                .lineLimit(1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 11)
        .frame(width: width, alignment: .leading)
        .background(.white.opacity(0.94), in: .rect(cornerRadius: 16))
        .shadow(color: .black.opacity(0.14), radius: 8, y: 4)
        .environment(\.colorScheme, .light)
        .accessibilityElement(children: .combine)
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

/// Pushed, the ride hides the tab bar and its bar keeps only back and the actions, in glass over
/// the map, which stays light in Dark Mode (docs/maps/README.md, WS2.7). Beside Rides it shares
/// Rides' bar, so it leaves the title and the tab bar alone.
private struct DetailChrome: ViewModifier {
    var title: String
    var pushed: Bool

    func body(content: Content) -> some View {
        #if os(iOS)
        let content = content
            .toolbarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
            .toolbarColorScheme(.light, for: .navigationBar)
        if pushed {
            content
                .navigationTitle(title)
                .toolbar(.hidden, for: .tabBar)
        } else {
            content
        }
        #else
        if pushed {
            content.navigationTitle(title)
        } else {
            content
        }
        #endif
    }
}

#Preview {
    NavigationStack {
        RideDetailView(board: .sample, pick: RideBoard.sample.picks[0])
    }
}

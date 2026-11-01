import SwiftUI
import MapKit
import CoreLocation
import Domain
import DesignSystem
import SharedUI

/// The Routes tab (docs/redesign/README.md, "Routes"): every shortlisted loop on one map, under a
/// floating panel holding the shortlist Rides ranks, then the rest of the library and the rides
/// marked as ridden. On iPhone the panel rests at medium or large over the tab bar, or collapses to
/// its search field to leave the map; on iPad and Mac it runs down the leading side. On the iPhone
/// Duo it docks leading in tent, under the map in open portrait, and open in landscape the library
/// is the leading pane and the map the trailing one, with the selected route's `RouteCard`
/// (DESIGN-SYSTEM.md §5).
///
/// The caller owns `library` and saves shortlist edits, and registers the `RideBoard.Pick`
/// destination "Details" pushes (Ride detail lives in RideUI, which RoutesUI can't import).
/// Without a `board`, every shortlisted route shows as checking.
public struct RoutesView: View {
    private let board: RideBoard?
    @Binding private var library: RouteLibrary
    @State private var selection: Selection?
    @State private var segment = Segment.library
    @State private var query = ""
    @State private var detent = PanelDetent.medium
    @State private var camera: MapCameraPosition
    @State private var look = MapLook.initial
    @State private var carouselID: UUID?
    @State private var locationManager = CLLocationManager()
    /// The map has the whole width, beside nothing (Full Screen; Show Library gives it back).
    @State private var fullScreen = false
    /// How far the library is scrolled, kept as the phone opens and closes.
    @State private var scrollY: CGFloat = 0
    @State private var listPosition = ScrollPosition(edge: .top)
    @State private var cardHeight: CGFloat = 0
    @FocusState private var searching: Bool

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.paneShape) private var paneShape
    #if os(iOS)
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    #endif
    @Environment(\.unitSystem) private var unitSystem

    public init(library: Binding<RouteLibrary>, board: RideBoard?) {
        self.board = board
        _library = library
        _selection = State(initialValue: library.wrappedValue.shortlist.first.map(Selection.route))
        _camera = State(initialValue: Self.framing(library.wrappedValue, selected: nil))
    }

    enum Selection: Hashable {
        case route(UUID)
        case ride(String)
    }

    enum Segment: Hashable {
        case library, history
    }

    /// Where the panel goes, from the space Routes has.
    private enum Arrangement: Equatable {
        /// Over the map with detents: iPhone, a closed iPhone Duo and compact iPad.
        case floating
        /// A column down the leading side: tent, iPad and Mac.
        case column(width: CGFloat)
        /// Docked under the map, which has the top half: an open iPhone Duo in portrait.
        case portrait
        /// The library beside the map: an open iPhone Duo in landscape.
        case split
    }

    private var arrangement: Arrangement {
        switch paneShape {
        case .narrow: .floating
        case .tent: .column(width: Self.tentPanelWidth)
        case .portrait: .portrait
        case .wide: .split
        case nil: compactWidth ? .floating : .column(width: Self.sidePanelWidth)
        }
    }

    private var isSplit: Bool { arrangement == .split }

    public var body: some View {
        GeometryReader { proxy in
            switch arrangement {
            case .floating: floating(proxy)
            case .column(let width): column(proxy, width: width)
            case .portrait: portrait(proxy)
            case .split: split(proxy)
            }
        }
        .navigationTitle("Routes")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(removing: .title)
        // Only where it holds something: the rail, open portrait's "+" and the split's map actions.
        .toolbar(showsNavigationBar ? .automatic : .hidden, for: .navigationBar)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        // The cycle map stays light in Dark Mode (docs/maps/README.md, WS2.7), so the status bar's
        // glyphs go dark over it. Not the tab bar: forcing it light drops the accent from the selected tab.
        .toolbarColorScheme(cycleMap ? .light : nil, for: .navigationBar)
        .toolbar { toolbarItems }
        #endif
        .sensoryFeedback(.selection, trigger: selection)
        .sensoryFeedback(.impact(flexibility: .soft), trigger: library.shortlist)
        .onChange(of: searching) { _, searching in
            if searching, arrangement == .floating, detent != .large {
                withAnimation(Motion.panelDetent()) { detent = .large }
            }
        }
        .onChange(of: isSplit) { _, split in
            if !split { fullScreen = false }
        }
        .onChange(of: selection) { reframe() }
        .onChange(of: library.shortlist) { reframe() }
    }

    /// Medium leaves the top 44% of the space for the map; large reaches the safe area.
    private func floating(_ proxy: GeometryProxy) -> some View {
        let safeArea = proxy.safeAreaInsets
        let large = max(proxy.size.height - 14, 0)
        let medium = (large * 0.56).rounded()
        return ZStack(alignment: .bottom) {
            map(padding: EdgeInsets(top: safeArea.top + 8, leading: 0, bottom: safeArea.bottom + 14 + medium + 8, trailing: 0),
                showsCallout: detent != .large)
            controls
                .opacity(detent == .large ? 0 : 1)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            panel(heights: medium...large)
                .padding(.horizontal, 8)
                .padding(.bottom, 14)
        }
    }

    private func column(_ proxy: GeometryProxy, width: CGFloat) -> some View {
        let safeArea = proxy.safeAreaInsets
        return ZStack(alignment: .topLeading) {
            map(padding: EdgeInsets(top: safeArea.top + 8, leading: safeArea.leading + 8 + width + 8, bottom: safeArea.bottom + 8, trailing: safeArea.trailing + 8),
                showsCallout: true)
            controls
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            panel(heights: nil)
                .frame(width: width)
                .padding(8)
        }
    }

    /// The map frames the routes in the top half, and the panel fills the rest, down to the tab bar.
    private func portrait(_ proxy: GeometryProxy) -> some View {
        let safeArea = proxy.safeAreaInsets
        let full = proxy.size.height + safeArea.top + safeArea.bottom
        let mapHeight = (full / 2).rounded()
        let panelTop = mapHeight + 8 - safeArea.top
        return ZStack(alignment: .bottom) {
            map(padding: EdgeInsets(top: safeArea.top + 8, leading: 0, bottom: full - mapHeight + 8, trailing: 0), showsCallout: true)
            controls
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            panel(heights: nil)
                .frame(height: max(proxy.size.height - panelTop - 8, 0))
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
        }
    }

    /// The open phone in landscape: the library on the leading half, up to the fold, and the map
    /// beside it with the selected route's card. Full Screen gives the map the library's half too.
    private func split(_ proxy: GeometryProxy) -> some View {
        let safeArea = proxy.safeAreaInsets
        let full = proxy.size.width + safeArea.leading + safeArea.trailing
        let listWidth = (full / 2).rounded(.down) - safeArea.leading
        return ZStack(alignment: .trailing) {
            listPane
                .frame(width: listWidth)
                .frame(maxWidth: .infinity, alignment: .leading)
                .opacity(fullScreen ? 0 : 1)
                .allowsHitTesting(!fullScreen)
                .accessibilityHidden(fullScreen)
            mapPane(safeArea: safeArea)
                .frame(width: fullScreen ? proxy.size.width : proxy.size.width - listWidth)
        }
        #if os(iOS)
        // The rail keeps the map's actions however the library scrolls.
        .toolbarMinimizationBehavior(.never, for: .navigationBar)
        #endif
    }

    /// iPhone (and compact iPad) without a pane shape: the panel floats at the bottom with detents.
    private var compactWidth: Bool {
        #if os(iOS)
        horizontalSizeClass == .compact
        #else
        false
        #endif
    }

    /// The bars hold "+" (the rail, open portrait, the library's pane bar), so the panel doesn't.
    private var showsNavigationBar: Bool {
        #if os(iOS)
        isSplit || arrangement == .portrait || toolbarVerticalEdge != nil
        #else
        false
        #endif
    }

    private static let sidePanelWidth: CGFloat = 380
    private static let tentPanelWidth: CGFloat = 310

    /// The cycle map instead of MapKit's imagery: light, so nothing dims it and its controls take
    /// regular glass.
    private var cycleMap: Bool { look == .cycle }

    // MARK: Map

    private func map(padding: EdgeInsets, showsCallout: Bool) -> some View {
        RoutesMap(routes: shortlisted, selected: selectedRoute, calloutDetail: showsCallout ? calloutDetail : nil,
                  camera: $camera, look: look) { id in
            select(.route(id))
        }
        .safeAreaPadding(padding)
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            // Dims under the status bar so its glyphs and the map controls stay legible over imagery (§2).
            if !cycleMap {
                LinearGradient(colors: [.black.opacity(0.34), .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: 110)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
    }

    private var controls: some View {
        MapControls(look: $look, overLightMap: cycleMap) {
            if locationManager.authorizationStatus == .notDetermined {
                locationManager.requestWhenInUseAuthorization()
            }
            withAnimation(Motion.panelMaterialize) { camera = .userLocation(fallback: camera) }
        }
        .padding(.trailing, 16)
        .animation(Motion.panelMaterialize, value: detent)
    }

    /// The shortlist and the selected route, with a margin, so every drawn loop is in view.
    private static func framing(_ library: RouteLibrary, selected: RouteLibrary.Route?) -> MapCameraPosition {
        let drawn = library.shortlist.compactMap { id in library.routes.first { $0.id == id } } + [selected].compactMap { $0 }
        let box = drawn.flatMap(\.locations).reduce(MKMapRect.null) { box, location in
            box.union(MKMapRect(origin: MKMapPoint(location), size: MKMapSize(width: 0, height: 0)))
        }
        guard !box.isNull else { return .userLocation(fallback: .automatic) }
        return .rect(box.insetBy(dx: -box.width * 0.12, dy: -box.height * 0.12))
    }

    private func reframe() {
        withAnimation(Motion.panelMaterialize) { camera = Self.framing(library, selected: selectedRoute) }
    }

    // MARK: Panel

    private func panel(heights: ClosedRange<CGFloat>?) -> some View {
        FloatingPanel("Routes", detent: $detent, heights: heights, scrollOffset: $scrollY) {
            searching = false
        } header: {
            HStack(spacing: 10) {
                searchField
                if !showsNavigationBar {
                    panelAddMenu
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        } content: {
            libraryContent
        }
    }

    /// The shortlist, then the library or history: the panel's content, and the open phone's
    /// leading pane.
    private var libraryContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            shortlistHeader
            carousel
            Picker("Show", selection: $segment) {
                Text("Library \(libraryRoutes.count)").tag(Segment.library)
                Text("History \(library.rides.count)").tag(Segment.history)
            }
            .pickerStyle(.segmented)
            .padding(EdgeInsets(top: 6, leading: 16, bottom: 8, trailing: 16))
            switch segment {
            case .library: libraryList
            case .history: historyList
            }
        }
        .animation(Motion.glassTapLayout, value: selection)
    }

    // MARK: Panes

    /// The library beside the map: its own bar on top, since the rail belongs to the map.
    private var listPane: some View {
        ScrollView {
            libraryContent
                .padding(.bottom, 28)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollPosition($listPosition)
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in
            scrollY = max(y, 0)
        }
        .onAppear {
            if scrollY > 0 { listPosition.scrollTo(y: scrollY) }
        }
        .safeAreaBar(edge: .top) {
            VStack(spacing: 0) {
                PaneBar("Routes") {
                    addMenu
                }
                searchField
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
        .background(.background)
    }

    /// The map beside the library, under the rail, with the selected route's card at its foot.
    private func mapPane(safeArea: EdgeInsets) -> some View {
        ZStack(alignment: .bottomLeading) {
            map(padding: EdgeInsets(top: safeArea.top + 8, leading: (fullScreen ? safeArea.leading : 0) + 8,
                                    bottom: safeArea.bottom + 8 + cardHeight + 8, trailing: safeArea.trailing + 8),
                showsCallout: true)
            controls
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            if let route = selectedRoute {
                RouteCard(route: route, status: library.shortlist.contains(route.id) ? status(for: route.id) : nil,
                          riddenOn: selectedRide?.riddenOn, pick: pick(for: route.id))
                    .frame(maxWidth: 400)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cardHeight = $0 }
                    .padding(8)
                    .transition(.opacity)
            }
        }
        .onChange(of: selectedRoute == nil) { _, none in
            if none { cardHeight = 0 }
        }
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("Search Routes", text: $query)
                .focused($searching)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .accessibilityIdentifier("routes-search")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 36)
        .background(.fill.tertiary, in: .capsule)
    }

    @ViewBuilder private var addRoutesItems: some View {
        // ponytail: no-ops until the import flows are rebuilt on the API (docs/redesign/README.md, "Routes").
        Button {} label: {
            Label("Import GPX File", systemImage: "doc")
        }
        Button {} label: {
            Text("From cycle.travel")
            Text("Use the Safari extension")
            Image(systemName: "safari")
        }
        Divider()
        Button {} label: {
            Text("Connect Strava")
            Text("Coming soon")
            Image(systemName: "link")
        }
        .disabled(true)
    }

    /// "+" in the bars: the rail, open portrait's navigation bar, the library's pane bar.
    private var addMenu: some View {
        Menu("Add Routes", systemImage: "plus") { addRoutesItems }
    }

    /// "+" in the panel's header, beside search, where there's no bar to hold it.
    private var panelAddMenu: some View {
        Menu {
            addRoutesItems
        } label: {
            Image(systemName: "plus")
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)
                .frame(width: 36, height: 36)
                .background(.fill.tertiary, in: .circle)
                .contentShape(.circle)
        }
        .tint(.primary)
        .accessibilityLabel("Add Routes")
    }

    // MARK: Shortlist

    private var shortlistHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Shortlist")
                .font(.headline.bold())
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Text("\(library.shortlist.count) of \(library.shortlistLimit)")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .monospacedDigit()
        }
        .padding(EdgeInsets(top: 6, leading: 20, bottom: 4, trailing: 20))
    }

    @ViewBuilder
    private var carousel: some View {
        let routes = shortlisted.filter(matches)
        if routes.isEmpty {
            Text(query.isEmpty ? "Add routes from your library to compare them on Rides." : "No shortlisted routes match “\(query)”.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, minHeight: 155)
                .overlay {
                    RoundedRectangle(cornerRadius: CornerRadius.card)
                        .strokeBorder(.separator, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                }
                .padding(EdgeInsets(top: 6, leading: 16, bottom: 8, trailing: 16))
        } else {
            ScrollView(.horizontal) {
                LazyHStack(spacing: 10) {
                    ForEach(routes) { route in
                        let pick = pick(for: route.id)
                        ShortlistCard(route: route, status: status(for: route.id), score: pick?.score,
                                      isSelected: selectedRoute?.id == route.id) {
                            select(.route(route.id))
                        } remove: {
                            unshortlist(route.id)
                        }
                        .id(route.id)
                    }
                }
                .scrollTargetLayout()
                // Room for the selected card's outline.
                .padding(.vertical, 6)
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .scrollPosition(id: $carouselID, anchor: .leading)
            .padding(.bottom, 2)
        }
    }

    private func status(for id: UUID) -> ShortlistStatus {
        if let pick = pick(for: id) {
            if pick.id == board?.picks.first?.id { return .best(day: pick.start.formatted(.dateTime.weekday(.abbreviated))) }
            if !pick.meetsMinimums { return .belowMinimums }
            return .ranked(start: "\(pick.start.formatted(.dateTime.weekday(.abbreviated))) \(pick.start.formatted(.clockTime))")
        }
        return board?.unfit.contains { $0.route.id == id } == true ? .tooLong : .checking
    }

    // MARK: Library and history

    @ViewBuilder
    private var libraryList: some View {
        let routes = libraryRoutes.filter(matches)
        if library.routes.isEmpty {
            emptyNote("Routes you import with the Ride On extension on cycle.travel appear here.")
        } else if routes.isEmpty {
            emptyNote(query.isEmpty ? "Every route is on your shortlist." : "No library routes match.")
        } else {
            ForEach(routes) { route in
                LibraryRow(route: route, isSelected: selection == .route(route.id), canAdd: canAddToShortlist,
                           pick: pick(for: route.id)) {
                    select(.route(route.id))
                } add: {
                    shortlist(route.id)
                }
            }
        }
    }

    @ViewBuilder
    private var historyList: some View {
        let rides = library.rides.filter { matches($0.route) }
        if rides.isEmpty {
            emptyNote(query.isEmpty ? "Rides you mark as ridden appear here." : "No rides match.")
        } else {
            ForEach(Self.months(rides), id: \.start) { month in
                monthHeader(month.start, count: month.rides.count)
                ForEach(month.rides) { ride in
                    HistoryRow(ride: ride, isSelected: selection == .ride(ride.id),
                               showsAdd: library.routes.contains { $0.id == ride.route.id } && !library.shortlist.contains(ride.route.id),
                               canAdd: canAddToShortlist, pick: pick(for: ride.route.id)) {
                        select(.ride(ride.id))
                    } add: {
                        shortlist(ride.route.id)
                    }
                }
            }
            Text("Weather is the forecast from when you planned each ride, not what you rode in.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .padding(.horizontal, 22)
                .padding(.top, 10)
        }
    }

    private func monthHeader(_ month: Date, count: Int) -> some View {
        let sameYear = Calendar.current.isDate(month, equalTo: .now, toGranularity: .year)
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(month.formatted(sameYear ? .dateTime.month(.wide) : .dateTime.month(.wide).year()))
                .font(.subheadline.weight(.semibold))
            Text(count == 1 ? "1 ride" : "\(count) rides")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        }
        .padding(EdgeInsets(top: 14, leading: 20, bottom: 2, trailing: 20))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func emptyNote(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.tertiary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 22)
            .padding(.horizontal, 20)
    }

    /// Rides grouped by calendar month, newest first, as `library.rides` is.
    private static func months(_ rides: [RouteLibrary.Ride]) -> [(start: Date, rides: [RouteLibrary.Ride])] {
        rides.reduce(into: []) { months, ride in
            let start = Calendar.current.dateInterval(of: .month, for: ride.riddenOn)?.start ?? ride.riddenOn
            if months.last?.start == start {
                months[months.count - 1].rides.append(ride)
            } else {
                months.append((start, [ride]))
            }
        }
    }

    // MARK: State

    private var shortlisted: [RouteLibrary.Route] {
        library.shortlist.compactMap { id in library.routes.first { $0.id == id } }
    }

    private var libraryRoutes: [RouteLibrary.Route] {
        library.routes.filter { !library.shortlist.contains($0.id) }
    }

    private var canAddToShortlist: Bool { library.shortlist.count < library.shortlistLimit }

    private var selectedRoute: RouteLibrary.Route? {
        switch selection {
        case .route(let id): library.routes.first { $0.id == id }
        case .ride(let id): library.rides.first { $0.id == id }?.route
        case nil: nil
        }
    }

    /// The route's length, or for a ride the day it was ridden.
    private var calloutDetail: String? {
        switch selection {
        case .route:
            selectedRoute.map { UnitFormat.distance(km: $0.distanceKm, system: unitSystem, fractionDigits: 0) }
        case .ride(let id):
            library.rides.first { $0.id == id }.map { RoutesFormat.shortDate($0.riddenOn) }
        case nil:
            nil
        }
    }

    private func pick(for routeID: UUID) -> RideBoard.Pick? {
        board?.picks.first { $0.route.id == routeID }
    }

    private func matches(_ route: RouteLibrary.Route) -> Bool {
        let query = query.trimmingCharacters(in: .whitespaces)
        return query.isEmpty || route.name.localizedStandardContains(query) || route.source.title.localizedStandardContains(query)
    }

    private func select(_ selection: Selection) {
        self.selection = selection
        if case .route(let id) = selection, library.shortlist.contains(id) {
            withAnimation(Motion.glassTapLayout) { carouselID = id }
        }
    }

    private func shortlist(_ id: UUID) {
        guard canAddToShortlist, !library.shortlist.contains(id) else { return }
        withAnimation(Motion.glassTapLayout) { library.shortlist.append(id) }
        withAnimation(Motion.glassTapLayout) { carouselID = id }
    }

    private func unshortlist(_ id: UUID) {
        withAnimation(Motion.glassTapLayout) { library.shortlist.removeAll { $0 == id } }
    }

    private var selectedRide: RouteLibrary.Ride? {
        guard case .ride(let id) = selection else { return nil }
        return library.rides.first { $0.id == id }
    }

    /// The selected route, when it's in the library (a ridden route may not be any more).
    private var selectedLibraryRoute: RouteLibrary.Route? {
        selectedRoute.flatMap { route in library.routes.first { $0.id == route.id } }
    }

    // MARK: Toolbar

    #if os(iOS)
    @ToolbarContentBuilder private var toolbarItems: some ToolbarContent {
        if isSplit {
            // Side by side, the rail belongs to the map; the library's "+" is in its pane bar.
            ToolbarItem(placement: .primaryAction) {
                Button(fullScreen ? "Show Library" : "Full Screen",
                       systemImage: fullScreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                    withAnimation(Motion.paneResize) { fullScreen.toggle() }
                }
            }
            .visibilityPriority(.high)
            if let route = selectedLibraryRoute {
                ToolbarItem(placement: .primaryAction) { shortlistButton(route) }
                    .visibilityPriority(.high)
            }
            ToolbarOverflowMenu {
                if let url = selectedRoute.flatMap({ pick(for: $0.id)?.route.cycleTravelURL }) {
                    Link(destination: url) {
                        Label("Open in cycle.travel", systemImage: "arrow.up.forward.square")
                    }
                }
                // ponytail: disabled until the API can delete a route (the worker deletes rides only).
                Button("Delete Route", systemImage: "trash", role: .destructive) {}
                    .disabled(true)
            }
        } else if toolbarVerticalEdge != nil {
            // On the rail, the create action sits at the bottom, by the thumb.
            ToolbarItem(placement: .bottomBar) { addMenu }
        } else if arrangement == .portrait {
            ToolbarItem(placement: .primaryAction) { addMenu }
        }
    }
    #endif

    private func shortlistButton(_ route: RouteLibrary.Route) -> some View {
        let shortlisted = library.shortlist.contains(route.id)
        return Button(shortlisted ? "Remove from Shortlist" : "Add to Shortlist", systemImage: shortlisted ? "star.fill" : "star") {
            if shortlisted { unshortlist(route.id) } else { shortlist(route.id) }
        }
        .disabled(!shortlisted && !canAddToShortlist)
    }
}

#Preview {
    @Previewable @State var library = RouteLibrary.sample
    NavigationStack {
        RoutesView(library: $library, board: .sample)
    }
}

// The iPhone Duo's poses beside the rail (PaneShape), for the canvas: the simulator can't fold.
#Preview("Tent", traits: .fixedLayout(width: 606, height: 466)) {
    @Previewable @State var library = RouteLibrary.sample
    NavigationStack { RoutesView(library: $library, board: .sample) }
        .measuresPaneShape()
}

#Preview("Open, landscape", traits: .fixedLayout(width: 879, height: 669)) {
    @Previewable @State var library = RouteLibrary.sample
    NavigationStack { RoutesView(library: $library, board: .sample) }
        .measuresPaneShape()
}

#Preview("Open, portrait", traits: .fixedLayout(width: 669, height: 951)) {
    @Previewable @State var library = RouteLibrary.sample
    NavigationStack { RoutesView(library: $library, board: .sample) }
        .measuresPaneShape()
}

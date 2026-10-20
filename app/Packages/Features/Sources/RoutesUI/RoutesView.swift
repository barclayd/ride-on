import SwiftUI
import MapKit
import CoreLocation
import Models
import DesignSystem
import SharedUI

/// The Routes tab (docs/redesign/README.md, "Routes"): every shortlisted loop on one map, under a
/// floating panel holding the shortlist Rides ranks, then the rest of the library and the rides
/// marked as ridden. On iPhone the panel runs behind the tab bar and rests at Find My's four heights,
/// down to just its grabber around the tab bar to leave the map; on iPad and Mac it runs down the
/// leading side.
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
    @State private var scrolled = false
    @State private var camera: MapCameraPosition
    @State private var look = MapLook.initial
    @State private var carouselID: UUID?
    @State private var locationManager = CLLocationManager()
    @FocusState private var searching: Bool

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

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

    public var body: some View {
        GeometryReader { proxy in
            let safeArea = proxy.safeAreaInsets
            if floats {
                // Up from the bottom of the screen, which the panel runs down to behind the tab bar:
                // small shows the title and the top of the shortlist, medium half the screen, and
                // large reaches the safe area. With the keyboard up the bottom inset is its height
                // (and the size shrinks by as much), so the list scrolls clear of it.
                let screen = proxy.size.height + safeArea.top + safeArea.bottom
                let heights = PanelHeights(small: max((screen * 0.3).rounded(), safeArea.bottom + 160),
                                           medium: (screen * 0.5).rounded(), large: screen - safeArea.top,
                                           tabBar: safeArea.bottom)
                ZStack(alignment: .bottom) {
                    map(padding: EdgeInsets(top: safeArea.top + 8, leading: 0, bottom: heights.medium + 8, trailing: 0),
                        showsCallout: detent != .large)
                    controls
                        .opacity(detent == .large ? 0 : 1)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    panel(heights: heights)
                }
                .ignoresSafeArea(edges: .bottom)
            } else {
                ZStack(alignment: .topLeading) {
                    map(padding: EdgeInsets(top: safeArea.top + 8, leading: safeArea.leading + 8 + Self.sidePanelWidth + 8, bottom: safeArea.bottom + 8, trailing: 8),
                        showsCallout: true)
                    controls
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    panel(heights: nil)
                        .frame(width: Self.sidePanelWidth)
                        .padding(8)
                }
            }
        }
        .navigationTitle("Routes")
        #if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
        // The cycle map stays light in Dark Mode (docs/maps/README.md, WS2.7), so the status bar's
        // glyphs go dark over it. Not the tab bar: forcing it light drops the accent from the selected tab.
        .toolbarColorScheme(cycleMap ? .light : nil, for: .navigationBar)
        #endif
        .sensoryFeedback(.selection, trigger: selection)
        .sensoryFeedback(.impact(flexibility: .soft), trigger: library.shortlist)
        .onChange(of: searching) { _, searching in
            if searching, floats, detent != .large {
                withAnimation(Motion.panelDetent()) { detent = .large }
            }
        }
        .onChange(of: selection) { reframe() }
        .onChange(of: library.shortlist) { reframe() }
    }

    /// iPhone (and compact iPad): the panel floats at the bottom with detents.
    private var floats: Bool {
        #if os(iOS)
        horizontalSizeClass == .compact
        #else
        false
        #endif
    }

    private static let sidePanelWidth: CGFloat = 380

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

    private func panel(heights: PanelHeights?) -> some View {
        FloatingPanel(detent: $detent, heights: heights, scrolled: $scrolled) {
            searching = false
        } header: {
            HStack(spacing: 10) {
                titleOrSearch
                addMenu
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        } content: {
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
    }

    /// On iPhone the title until the list scrolls, then search in its place, as Find My's sheet.
    private var titleOrSearch: some View {
        ZStack(alignment: .leading) {
            Text("Routes")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
                .opacity(showsSearch ? 0 : 1)
                .offset(y: showsSearch && !reduceMotion ? -12 : 0)
                .accessibilityHidden(showsSearch)
                .allowsHitTesting(!showsSearch)
            searchField
                .opacity(showsSearch ? 1 : 0)
                .offset(y: showsSearch || reduceMotion ? 0 : 12)
                .accessibilityHidden(!showsSearch)
                .allowsHitTesting(showsSearch)
        }
        .animation(Motion.panelMaterialize, value: showsSearch)
    }

    /// Search shows once the list scrolls and while it's in use; always beside the map on iPad and
    /// Mac, and with VoiceOver, so it's there to find.
    private var showsSearch: Bool {
        !floats || scrolled || searching || !query.isEmpty || voiceOver
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

    private var addMenu: some View {
        Menu {
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
                            withAnimation(Motion.glassTapLayout) { library.shortlist.removeAll { $0 == route.id } }
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
}

#Preview {
    @Previewable @State var library = RouteLibrary.sample
    NavigationStack {
        RoutesView(library: $library, board: .sample)
    }
}

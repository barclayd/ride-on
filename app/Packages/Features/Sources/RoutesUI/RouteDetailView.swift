import SwiftUI
import SwiftData
import MapKit
import Models
import Engine
import Services
import DesignSystem
import SharedUI

/// DESIGN-SYSTEM.md §9 Route Detail: map hero, `ElevationProfile` scrub-synced
/// to a dot on the map, `SurfaceBar`, stats, `BestDayBadge`, ride history,
/// GPX re-export. Zoom-in transition from the Today card is applied by the
/// App shell (the `.navigationDestination` call site owns the shared
/// `Namespace`, so this view doesn't need one threaded in).
public struct RouteDetailView: View {
    public var routeID: UUID

    @Query private var routes: [RouteModel]
    @Query private var rideLogModels: [RideLogModel]
    @Query private var savedPlaces: [SavedPlaceModel]
    @Environment(\.services) private var services
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.unitSystem) private var unitSystem

    // Scrub position lives in an @Observable so a hover only invalidates the
    // one view that reads it (the elevation chart) — NOT this whole view,
    // which would otherwise re-run RouteStats/ride-log sorting/inspector on
    // every tick. Body never reads `.selectedDistanceKm`, so it isn't
    // subscribed; only the chart does, and re-renders alone.
    @State private var scrub = ElevationScrubState()
    // Cached per-route so scrubbing doesn't re-run the O(n) cumulative-haversine
    // walk each frame — recomputed only when the route changes, in `.task(id:)`.
    @State private var elevationPoints: [ElevationPoint] = []
    // Likewise the map geometry: `route.coordinates` decodes ~5k points out of
    // packed `Data` on every access, and a fresh array each tick makes SwiftUI
    // reload the whole `MapPolyline` overlay just to move the marker. Decode
    // once so the polyline is stable and only the marker diffs while scrubbing.
    @State private var mapCoordinates: [CLLocationCoordinate2D] = []
    @State private var mapRegion: MKCoordinateRegion?
    @State private var bestDay: (context: DailyContext, score: Double)?
    @State private var exportedGPXURL: URL?
    @State private var isInspectorPresented = true
    @State private var isMapExpanded = false
    @State private var isEditing = false

    public init(routeID: UUID) {
        self.routeID = routeID
        _routes = Query(filter: #Predicate<RouteModel> { $0.id == routeID })
    }

    private var route: RouteModel? { routes.first }

    public var body: some View {
        Group {
            if let route {
                content(for: route)
            } else {
                ContentUnavailableView("Route Not Found", systemImage: "map")
            }
        }
        // Landmarks rename idiom: an editable navigation title — the title
        // menu on iOS, click-to-edit in the Mac toolbar — instead of a
        // custom rename sheet.
        .navigationTitle(Binding(
            get: { route?.name ?? "Route" },
            set: { newName in
                let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { route?.name = trimmed }
            }
        ))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        // Expose the edit action to the Mac menu bar ("Edit Route Details…");
        // nil when no route is showing so the command disables itself.
        .focusedSceneValue(\.routeEditAction, route == nil ? nil : { isEditing = true })
    }

    @ViewBuilder
    private func content(for route: RouteModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // The inline hero stays inert (an interactive map inside a
                // ScrollView steals the scroll gesture) — tapping expands to
                // a fully pannable map sheet instead (REDESIGN.md D).
                RouteMapHero(routeID: route.id, coordinates: route.coordinates)
                    .frame(height: 260)
                    .clipShape(.rect(cornerRadius: CornerRadius.hero))
                    .contentShape(.rect)
                    .onTapGesture { isMapExpanded = true }
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel("Route map")
                    .accessibilityHint("Double tap to expand")

                // On Mac these live in the inspector column instead
                // (Landmarks idiom, REDESIGN.md A); iPhone/iPad keep them
                // inline.
                #if !os(macOS)
                if let bestDay {
                    BestDayBadge(dayName: bestDay.context.date.formatted(.dateTime.weekday(.wide)), summary: "Score \(Int((bestDay.score * 100).rounded()))")
                }

                statsRow(for: route)

                // On Mac the description lives in the inspector's Details
                // section instead (Landmarks idiom); iPhone/iPad show it inline.
                descriptionSection(for: route)
                #endif

                if !elevationPoints.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Elevation").font(.headline)
                        ElevationProfile(points: elevationPoints, selectedDistanceKm: Binding(
                            get: { scrub.selectedDistanceKm },
                            set: { scrub.selectedDistanceKm = $0 }
                        ))
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Surface").font(.headline)
                    SurfaceBar(surfaces: route.surfaces ?? SurfaceBreakdown(distanceKmBySurface: [:]))
                }

                #if !os(macOS)
                rideHistorySection(for: route)

                // Landmarks-style attribution footer: provenance in quiet
                // secondary text, not a stats row. Mac shows this in the
                // inspector's Details section instead.
                Text("Imported from \(sourceText(for: route)) on \(route.createdAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                #endif
            }
            .padding()
            // Landmarks caps reading width in wide windows instead of
            // stretching content edge-to-edge (no-op on iPhone).
            .frame(maxWidth: 700)
            .frame(maxWidth: .infinity)
        }
        #if os(macOS)
        // Stats/best day/history are reference info, not the visual content —
        // Landmarks puts that in an `.inspector` on Mac. Skipped on iPad: the
        // Routes tab is already a three-column split there, a fourth column
        // crowds it.
        .inspector(isPresented: $isInspectorPresented) {
            inspectorContent(for: route)
        }
        #endif
        // Landmarks toolbar idiom: share actions live in the toolbar's glass
        // capsule, not as an inline content button.
        .toolbar {
            #if os(macOS)
            // On Mac the routes split merges THIS detail toolbar with the
            // content column's (search field + Saved/Ridden picker + import).
            // Four separate trailing buttons overflowed the unified window
            // toolbar into a `>>` chevron and collapsed the search field, so
            // the detail contributes just two trailing items: an overflow menu
            // for the secondary actions + the inspector toggle. (REDESIGN.md C's
            // separate glass capsules assume the actions fit — merged across
            // columns they don't.)
            ToolbarItem(placement: .primaryAction) {
                Menu("Route Actions", systemImage: "ellipsis.circle") {
                    Button("Edit Route", systemImage: "pencil") { isEditing = true }
                    if let exportedGPXURL {
                        ShareLink(item: exportedGPXURL) {
                            Label("Export GPX", systemImage: "square.and.arrow.up")
                        }
                    }
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Route Info", systemImage: "info.circle") {
                    isInspectorPresented.toggle()
                }
            }
            #else
            ToolbarItem(placement: .primaryAction) {
                Button("Edit Route", systemImage: "pencil") { isEditing = true }
            }
            ToolbarItem(placement: .primaryAction) {
                if let exportedGPXURL {
                    ShareLink(item: exportedGPXURL) {
                        Label("Export GPX", systemImage: "square.and.arrow.up")
                    }
                }
            }
            #endif
        }
        .sheet(isPresented: $isMapExpanded) {
            expandedMap(for: route)
        }
        .sheet(isPresented: $isEditing) {
            RouteEditSheet(route: route)
        }
        .task(id: route.id) {
            elevationPoints = Self.elevationPoints(for: route)
            mapCoordinates = route.coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            mapRegion = RouteSnapshotService.region(fitting: route.coordinates)
            exportedGPXURL = Self.exportGPX(route: route)
            await loadBestDay(for: route)
        }
    }

    private func expandedMap(for route: RouteModel) -> some View {
        NavigationStack {
            Map(initialPosition: mapRegion.map { .region($0) } ?? .automatic) {
                MapPolyline(coordinates: mapCoordinates)
                    .stroke(Color.accentColor, lineWidth: 3)
            }
            .mapStyle(.standard(pointsOfInterest: .excludingAll))
            .navigationTitle(route.name)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { isMapExpanded = false }
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 700, minHeight: 500)
        #endif
    }


    #if os(macOS)
    private func inspectorContent(for route: RouteModel) -> some View {
        Form {
            Section("Stats") {
                LabeledContent("Distance", value: UnitFormat.distance(km: route.distanceKm, system: unitSystem))
                LabeledContent("Elevation Gain", value: elevationText(for: route))
                LabeledContent("Est. Time", value: estimatedTimeText(for: route))
            }
            if !route.notes.isEmpty {
                Section("Description") {
                    Text(AttributedString.linkified(route.notes))
                        .tint(Color.accentColor)
                        .textSelection(.enabled)
                }
            }
            Section("Details") {
                LabeledContent("Source", value: sourceText(for: route))
                LabeledContent("Imported", value: route.createdAt.formatted(date: .abbreviated, time: .omitted))
            }
            if let bestDay {
                Section("Best Day to Ride") {
                    BestDayBadge(dayName: bestDay.context.date.formatted(.dateTime.weekday(.wide)), summary: "Score \(Int((bestDay.score * 100).rounded()))")
                }
            }
            let logs = rideLogModels.filter { $0.routeID == route.id }.sorted { $0.date > $1.date }
            if !logs.isEmpty {
                Section("Ride History") {
                    ForEach(logs) { log in
                        Label(log.date.formatted(date: .abbreviated, time: .omitted), systemImage: "checkmark.circle.fill")
                    }
                }
            }
        }
        .formStyle(.grouped)
        .inspectorColumnWidth(min: 220, ideal: 260, max: 320)
    }
    #endif

    private func statsRow(for route: RouteModel) -> some View {
        // ponytail: `ViewThatFits` (native, no custom layout math) falls back
        // to a stacked column when the three side-by-side stats don't fit —
        // e.g. at accessibility Dynamic Type sizes — instead of truncating
        // or overlapping.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 24) {
                statColumn(title: "Distance", value: UnitFormat.distance(km: route.distanceKm, system: unitSystem))
                statColumn(title: "Elevation", value: elevationText(for: route))
                statColumn(title: "Est. Time", value: estimatedTimeText(for: route))
            }
            VStack(alignment: .leading, spacing: 12) {
                statColumn(title: "Distance", value: UnitFormat.distance(km: route.distanceKm, system: unitSystem))
                statColumn(title: "Elevation", value: elevationText(for: route))
                statColumn(title: "Est. Time", value: estimatedTimeText(for: route))
            }
        }
    }

    private func statColumn(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.monospacedDigit().bold())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
    }

    private func sourceText(for route: RouteModel) -> String {
        switch route.source {
        case .strava: "Strava"
        case .gpxImport: route.importedFrom ?? "GPX file"
        }
    }

    private func elevationText(for route: RouteModel) -> String {
        route.hasElevationData ? UnitFormat.elevation(m: route.elevationGainM, system: unitSystem) : "No data"
    }

    private func estimatedTimeText(for route: RouteModel) -> String {
        let seconds = RouteStats.estimatedRideTime(for: route, preferences: preferencesStore.preferences)
        let hours = Int(seconds / 3600)
        let minutes = Int((seconds.truncatingRemainder(dividingBy: 3600)) / 60)
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }

    @ViewBuilder
    private func descriptionSection(for route: RouteModel) -> some View {
        if !route.notes.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Description").font(.headline)
                Text(AttributedString.linkified(route.notes))
                    .font(.body)
                    .tint(Color.accentColor)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func rideHistorySection(for route: RouteModel) -> some View {
        let logs = rideLogModels.filter { $0.routeID == route.id }.sorted { $0.date > $1.date }
        if !logs.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Ride History").font(.headline)
                ForEach(logs) { log in
                    HStack {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text(log.date.formatted(date: .abbreviated, time: .omitted))
                        Spacer()
                    }
                    .font(.subheadline)
                }
            }
        }
    }

    private var startLocation: Coordinate {
        savedPlaces.first?.coordinate ?? Coordinate(latitude: 51.7520, longitude: -0.8010)
    }

    private func loadBestDay(for route: RouteModel) async {
        guard let weather = try? await services.weather.forecast(for: startLocation, on: .now) else { return }
        let calendar = Calendar.current
        let weekContexts = (0..<7).compactMap { offset -> DailyContext? in
            guard let date = calendar.date(byAdding: .day, value: offset, to: .now) else { return nil }
            return Recommendations.context(
                date: date,
                startLocation: startLocation,
                hoursAvailable: 3,
                backBy: nil,
                intent: .exploring,
                bike: Bike.samples[0],
                weather: weather
            )
        }
        let scorer = Recommendations.scorer(
            preferences: preferencesStore.preferences,
            rideLogs: rideLogModels.compactMap { $0.asRideLog() },
            allRoutes: routes.map { $0.asRoute() },
            weights: preferencesStore.weights
        )
        bestDay = Recommendations.bestDay(for: route.asRoute(), weekContexts: weekContexts, scorer: scorer)
    }

    // ponytail: cumulative distance via a local haversine rather than
    // reusing Engine's `GPXGeometry` (internal to the Engine module, not
    // exposed publicly) — a dozen lines, not worth widening Engine's public
    // API for.
    private static func elevationPoints(for route: RouteModel) -> [ElevationPoint] {
        let coordinates = route.coordinates
        let elevations = route.elevations
        let count = min(coordinates.count, elevations.count)
        guard count > 1 else { return [] }

        var points: [ElevationPoint] = []
        var cumulativeKm = 0.0
        for index in 0..<count {
            if index > 0 {
                cumulativeKm += Self.haversineKm(coordinates[index - 1], coordinates[index])
            }
            guard let elevation = elevations[index] else { continue }
            points.append(ElevationPoint(id: index, distanceKm: cumulativeKm, elevationM: elevation))
        }
        return points
    }

    private static func haversineKm(_ a: Coordinate, _ b: Coordinate) -> Double {
        let earthRadiusKm = 6371.0
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return earthRadiusKm * 2 * atan2(sqrt(h), sqrt(1 - h))
    }

    // ponytail: hand-rolled minimal GPX (trk/trkseg/trkpt with ele) rather
    // than reusing `GPXParser` (a parser, not a serializer) — good enough to
    // round-trip the route's own geometry back out for sharing.
    private static func exportGPX(route: RouteModel) -> URL? {
        var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"RideOn\"><trk><name>\(route.name)</name><trkseg>\n"
        let coordinates = route.coordinates
        let elevations = route.elevations
        for index in 0..<coordinates.count {
            let coordinate = coordinates[index]
            xml += "<trkpt lat=\"\(coordinate.latitude)\" lon=\"\(coordinate.longitude)\">"
            if index < elevations.count, let elevation = elevations[index] {
                xml += "<ele>\(elevation)</ele>"
            }
            xml += "</trkpt>\n"
        }
        xml += "</trkseg></trk></gpx>"

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(route.name).gpx")
        do {
            try xml.write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            return nil
        }
    }
}

/// Landmarks-style edit sheet: name + a free-text description that may hold
/// external links. Edits a local draft and commits to the `RouteModel` only on
/// Done, so Cancel discards. Presented from the toolbar's Edit button and the
/// Mac "Edit Route Details…" menu command.
private struct RouteEditSheet: View {
    let route: RouteModel
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var notes: String

    init(route: RouteModel) {
        self.route = route
        _name = State(initialValue: route.name)
        _notes = State(initialValue: route.notes)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Route name", text: $name)
                }
                Section {
                    TextField("Add notes, or paste a link", text: $notes, axis: .vertical)
                        .lineLimit(4...12)
                } header: {
                    Text("Description")
                } footer: {
                    Text("Links you paste become tappable.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Edit Route")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !trimmed.isEmpty { route.name = trimmed }
                        route.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
                        dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 360)
        #endif
    }
}

/// Holds the elevation scrub position in an `@Observable` so only the views
/// that read it re-render on hover, keeping the rest of Route Detail still.
@Observable
final class ElevationScrubState {
    var selectedDistanceKm: Double?
}

/// The inline map hero: a *static* snapshot, not a live `Map`.
///
/// It used to be a live `Map` whose content closure placed a scrub-synced
/// marker. Because the closure read the scrub position, every scrub tick
/// re-ran it and made MapKit re-tessellate the whole multi-thousand-point
/// `MapPolyline` from scratch — dragging across the elevation chart on a long
/// route spiked memory to >1 GB and could take the Mac app down. The hero was
/// always inert anyway (tap-to-expand, `.allowsHitTesting(false)`), so it's
/// now the same cached `RouteSnapshotService` bitmap the Routes list and
/// import sheet use: bounded cost, no re-render on scrub, no live map left
/// mounted on a screen the user parks on. The live, pannable map lives only in
/// the tap-to-expand sheet now. (Trade: the scrub-synced *map* marker is gone;
/// the elevation chart still shows the scrub position.)
private struct RouteMapHero: View {
    let routeID: UUID
    let coordinates: [Coordinate]
    @Environment(\.colorScheme) private var colorScheme
    @State private var snapshot: PlatformImage?

    var body: some View {
        // The image lives in an `.overlay` of a clear spacer so it plays NO
        // part in layout sizing: `.scaledToFill()` reports an aspect-corrected
        // ideal width (~700pt for the 1400x520 snapshot) that a bare
        // `.frame(maxWidth:)` still passes through — the ScrollView adopts it,
        // the Mac detail column sizes to ideal + inspector and stops
        // compressing, and the whole window overflows (sidebar collapses,
        // inspector clips offscreen, toolbar spills into `>>`). An overlay
        // child is sized to the spacer and can't push back.
        Color.clear
            .overlay {
                if let snapshot {
                    Image(platformImage: snapshot).resizable().scaledToFill()
                } else {
                    Rectangle().fill(.secondary.opacity(0.15))
                }
            }
            .clipped()
            .task(id: routeID) {
                snapshot = await RouteSnapshotService.snapshot(
                    routeID: routeID,
                    coordinates: coordinates,
                    size: CGSize(width: 1400, height: 520),
                    colorScheme: colorScheme
                )
            }
    }
}

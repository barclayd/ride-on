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

    @State private var selectedDistanceKm: Double?
    @State private var bestDay: (context: DailyContext, score: Double)?
    @State private var exportedGPXURL: URL?
    @State private var isInspectorPresented = true
    @State private var isMapExpanded = false

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
        .navigationTitle(route?.name ?? "Route")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    private func content(for route: RouteModel) -> some View {
        let elevationPoints = elevationPoints(for: route)

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // The inline hero stays inert (an interactive map inside a
                // ScrollView steals the scroll gesture) — tapping expands to
                // a fully pannable map sheet instead (REDESIGN.md D).
                mapHero(for: route, elevationPoints: elevationPoints)
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
                #endif

                if !elevationPoints.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Elevation").font(.headline)
                        ElevationProfile(points: elevationPoints, selectedDistanceKm: $selectedDistanceKm)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Surface").font(.headline)
                    SurfaceBar(surfaces: route.surfaces ?? SurfaceBreakdown(distanceKmBySurface: [:]))
                }

                #if !os(macOS)
                rideHistorySection(for: route)
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
            ToolbarItem(placement: .primaryAction) {
                if let exportedGPXURL {
                    ShareLink(item: exportedGPXURL) {
                        Label("Export GPX", systemImage: "square.and.arrow.up")
                    }
                }
            }
            #if os(macOS)
            // Two trailing actions -> separate glass capsules (REDESIGN.md C).
            ToolbarSpacer(.fixed, placement: .primaryAction)
            ToolbarItem(placement: .primaryAction) {
                Button("Route Info", systemImage: "info.circle") {
                    isInspectorPresented.toggle()
                }
            }
            #endif
        }
        .sheet(isPresented: $isMapExpanded) {
            expandedMap(for: route)
        }
        .task(id: route.id) {
            exportedGPXURL = Self.exportGPX(route: route)
            await loadBestDay(for: route)
        }
    }

    @ViewBuilder
    private func mapHero(for route: RouteModel, elevationPoints: [ElevationPoint]) -> some View {
        let coordinates = route.coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        let selectedCoordinate = selectedMapCoordinate(route: route, elevationPoints: elevationPoints)

        Map(initialPosition: .region(RouteSnapshotService.region(fitting: route.coordinates))) {
            MapPolyline(coordinates: coordinates)
                .stroke(Color.accentColor, lineWidth: 3)
            if let selectedCoordinate {
                Marker("Selected", coordinate: selectedCoordinate)
                    .tint(Color.accentColor)
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .allowsHitTesting(false)
    }

    private func expandedMap(for route: RouteModel) -> some View {
        NavigationStack {
            Map(initialPosition: .region(RouteSnapshotService.region(fitting: route.coordinates))) {
                MapPolyline(coordinates: route.coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) })
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

    private func selectedMapCoordinate(route: RouteModel, elevationPoints: [ElevationPoint]) -> CLLocationCoordinate2D? {
        guard let selectedDistanceKm else { return nil }
        guard let nearest = elevationPoints.min(by: { abs($0.distanceKm - selectedDistanceKm) < abs($1.distanceKm - selectedDistanceKm) }) else { return nil }
        let coordinates = route.coordinates
        guard elevationPoints.firstIndex(where: { $0.id == nearest.id }) != nil, nearest.id < coordinates.count else { return nil }
        let coordinate = coordinates[nearest.id]
        return CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }

    #if os(macOS)
    private func inspectorContent(for route: RouteModel) -> some View {
        Form {
            Section("Stats") {
                LabeledContent("Distance", value: UnitFormat.distance(km: route.distanceKm, system: unitSystem))
                LabeledContent("Elevation Gain", value: elevationText(for: route))
                LabeledContent("Est. Time", value: estimatedTimeText(for: route))
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
    private func elevationPoints(for route: RouteModel) -> [ElevationPoint] {
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

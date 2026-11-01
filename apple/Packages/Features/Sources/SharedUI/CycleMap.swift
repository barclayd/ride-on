#if os(iOS)
import SwiftUI
import MapKit
import MapLibre
import DesignSystem
import Domain
import Services

/// A map in cycle.travel's look (DESIGN-SYSTEM.md §6 #17): MapLibre Native drawing Ride On's own
/// tiles with the style `maps/style` builds into `CycleMap/`. Routes are map layers under the labels:
/// the others in white, the selected one in the tint on a white casing with its start marked, or in
/// `stretches`' colours (the wind on ride detail), with an optional `pin` on it. Like `Map`, it fills
/// the screen and frames inside the safe area, framing again when the safe area changes unless the
/// user has moved the map. "© OpenStreetMap" sits in the safe
/// area's bottom leading corner until the map is moved or for 5 seconds, then fades; the full credits
/// are in Preferences → Maps (§2).
///
/// iOS only: MapLibre Native has no macOS build, so the Mac stays on MapKit (docs/maps/README.md, WS3.6).
public struct CycleMap: View {
    /// A route drawn on the map.
    public struct Line: Equatable, Identifiable {
        public var id: UUID
        public var coordinates: [Coordinate]

        public init(id: UUID, coordinates: [Coordinate]) {
            self.id = id
            self.coordinates = coordinates
        }
    }

    /// Part of the selected line drawn in its own colour, over the tint.
    public struct Stretch: Equatable {
        public var coordinates: [Coordinate]
        public var color: Color

        public init(coordinates: [Coordinate], color: Color) {
            self.coordinates = coordinates
            self.color = color
        }
    }

    /// A point on the selected line with a callout above it: where the finger is on Along the
    /// Route's profile.
    public struct Pin: Equatable {
        public var coordinate: Coordinate
        public var label: String

        public init(coordinate: Coordinate, label: String) {
            self.coordinate = coordinate
            self.label = label
        }
    }

    /// Where the map looks. The map moves when this changes; in between, the user's own panning is
    /// left alone.
    public enum Camera: Equatable {
        /// The rect, fitted inside the safe area.
        case rect(MKMapRect)
        /// Every line drawn, as MapKit's `.automatic`.
        case automatic
        /// Follows the user once they've allowed location; every line until then.
        case userLocation

        public static func == (a: Camera, b: Camera) -> Bool {
            switch (a, b) {
            case (.rect(let a), .rect(let b)): MKMapRectEqualToRect(a, b)
            case (.automatic, .automatic), (.userLocation, .userLocation): true
            default: false
            }
        }
    }

    var lines: [Line]
    var selected: Line?
    var stretches: [Stretch]
    var pin: Pin?
    var tint: Color
    var camera: Camera
    var callout: AnyView?
    var moved: (MKMapRect) -> Void
    var select: (UUID) -> Void

    @Environment(\.self) private var environment
    @State private var credited = true

    /// - Parameters:
    ///   - lines: Drawn white; `selected` is drawn over them.
    ///   - stretches: Drawn over `selected` in their own colours; the tint is hidden under them.
    ///   - pin: A white dot ringed in the tint, with its label in a callout above.
    ///   - callout: Pinned above the selected line's northernmost point.
    ///   - moved: The user moved the map; the rect now in view inside the safe area.
    ///   - select: The line within 22pt of a tap, the closest if several are.
    public init(lines: [Line], selected: Line? = nil, stretches: [Stretch] = [], pin: Pin? = nil,
                tint: Color = .accentColor, camera: Camera,
                callout: AnyView? = nil, moved: @escaping (MKMapRect) -> Void = { _ in },
                select: @escaping (UUID) -> Void = { _ in }) {
        self.lines = lines
        self.selected = selected
        self.stretches = stretches
        self.pin = pin
        self.tint = tint
        self.camera = camera
        self.callout = callout
        self.moved = moved
        self.select = select
    }

    public var body: some View {
        // Read inside the safe area, so the insets reach the map as its content inset.
        GeometryReader { geometry in
            ZStack(alignment: .bottomLeading) {
                MapView(lines: lines, selected: selected,
                        stretches: stretches.map { .init(coordinates: $0.coordinates, colour: uiColor($0.color)) },
                        pin: pin, tint: uiColor(tint),
                        camera: camera, callout: callout, insets: geometry.safeAreaInsets,
                        moved: { uncredit(); moved($0) }, select: select)
                    .ignoresSafeArea()
                if credited {
                    CycleMapAttribution()
                        .padding(.leading, 12)
                        .padding(.bottom, 4)
                        .transition(.opacity)
                }
            }
        }
        .task {
            if (try? await Task.sleep(for: .seconds(5))) != nil { uncredit() }
        }
    }

    private func uiColor(_ color: Color) -> UIColor {
        UIColor(Color(color.resolve(in: environment)))
    }

    /// OpenStreetMap's guidelines let an interactive map's credit go once the map is in use or after
    /// 5 seconds, so long as it can still be found (Preferences → Maps).
    private func uncredit() {
        guard credited else { return }
        withAnimation(Motion.panelMaterialize) { credited = false }
    }

    /// The bundled style with `bundle://` pointed at the resource bundle: Native needs absolute glyph
    /// URLs, so the style is rewritten once into Caches. `-CycleMapTiles <url>` swaps the tile host,
    /// e.g. `file:///…/tiles` for a folder holding local copies of the style's archives (`basemap-gb-*`,
    /// `cycling-gb-*`, `terrain-gb-*` and `contours-gb-*.pmtiles`).
    static let styleURL: URL = {
        let directory = Bundle.module.url(forResource: "CycleMap", withExtension: nil)!
        var json = try! String(contentsOf: directory.appending(path: "style.json"), encoding: .utf8)
            .replacingOccurrences(of: "bundle://", with: directory.absoluteString)
        if let tiles = UserDefaults.standard.string(forKey: "CycleMapTiles") {
            json = json.replacingOccurrences(of: "https://maps.ride-on.cc", with: tiles)
        } else if FixtureWorld.isEnabled {
            json = offline(json)
        }
        let url = URL.cachesDirectory.appending(path: "cycle-map-style.json")
        try! json.write(to: url, atomically: true, encoding: .utf8)
        return url
    }()

    /// The bundled style's land colour (its `background` layer): behind a snapshot until it's drawn.
    static let land = Color(red: 0xED / 255, green: 0xF2 / 255, blue: 0xE1 / 255)

    /// The fixture world never touches the network (docs/maps/README.md, WS3.7): the style's land
    /// colour alone, with no tile sources, under the routes. `-CycleMapTiles` brings the tiles back,
    /// as `capture/app-sim.sh` does for screenshots.
    private static func offline(_ json: String) -> String {
        guard var style = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let layers = style["layers"] as? [[String: Any]] else { return json }
        style["sources"] = [String: Any]()
        style["layers"] = layers.filter { $0["type"] as? String == "background" }
        return String(decoding: try! JSONSerialization.data(withJSONObject: style), as: UTF8.self)
    }
}

/// The cycle map's credit (§2). On the live map, "© OpenStreetMap" linking to its terms in the map's
/// own light scheme; the rest (Protomaps, and the terrain's Mapterhorn and Ordnance Survey) are in
/// Preferences → Maps (Wind on the Ride's snapshot uses it too). On a snapshot that's a button or a
/// link (a card, the Rides hero), "© OpenStreetMap" and "Protomaps" as plain text in white; the hero's
/// terrain is credited in Preferences → Maps with the rest.
public struct CycleMapAttribution: View {
    public enum Placement { case map, card }

    var placement: Placement

    public init(_ placement: Placement = .map) {
        self.placement = placement
    }

    public var body: some View {
        HStack(spacing: 10) {
            switch placement {
            case .map:
                Link("© OpenStreetMap", destination: URL(string: "https://www.openstreetmap.org/copyright")!)
                    .accessibilityLabel("Map data © OpenStreetMap contributors")
            case .card:
                Text("© OpenStreetMap")
                Text("Protomaps")
            }
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(placement == .map ? AnyShapeStyle(.secondary) : AnyShapeStyle(.white.opacity(0.75)))
        .padding(.vertical, 4)
        // Chrome over the map, held at a fixed size like MapKit's own Legal link.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .environment(\.colorScheme, placement == .map ? .light : .dark)
    }
}

/// A `CycleMap.Stretch` with its colour resolved.
private struct ResolvedStretch: Equatable {
    var coordinates: [Coordinate]
    var colour: UIColor
}

private struct MapView: UIViewRepresentable {
    var lines: [CycleMap.Line]
    var selected: CycleMap.Line?
    var stretches: [ResolvedStretch]
    var pin: CycleMap.Pin?
    var tint: UIColor
    var camera: CycleMap.Camera
    var callout: AnyView?
    /// The SwiftUI safe area, as the map's content inset: the view fills the screen and draws under it.
    var insets: EdgeInsets
    var moved: (MKMapRect) -> Void
    var select: (UUID) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let view = MLNMapView(frame: .zero, styleURL: CycleMap.styleURL)
        view.delegate = context.coordinator
        view.automaticallyAdjustsContentInset = false
        view.logoView.isHidden = true
        // `CycleMap` draws its own (§2).
        view.attributionButton.isHidden = true
        view.compassView.compassVisibility = .hidden
        // Great Britain, the tiles' coverage, until the camera first frames something.
        view.setCenter(CLLocationCoordinate2D(latitude: 54.3, longitude: -2.6), zoomLevel: 4.6, animated: false)
        view.accessibilityIdentifier = "cycle-map"
        // `-CycleMapCamera 51.4455,-0.2665,14` pins the camera (latitude, longitude, zoom) for
        // screenshots against the prototype (docs/maps/prototype); the camera is then ignored.
        if let pin = UserDefaults.standard.string(forKey: "CycleMapCamera")?.split(separator: ",").compactMap({ Double($0) }),
           pin.count == 3 {
            context.coordinator.pin = (CLLocationCoordinate2D(latitude: pin[0], longitude: pin[1]), pin[2])
        }
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped))
        // A double tap zooms, as on any map; it doesn't also select.
        for case let zoom as UITapGestureRecognizer in view.gestureRecognizers ?? [] where zoom.numberOfTapsRequired == 2 {
            tap.require(toFail: zoom)
        }
        view.addGestureRecognizer(tap)
        context.coordinator.attach(view)
        return view
    }

    func updateUIView(_ view: MLNMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.moved = moved
        coordinator.select = select
        coordinator.camera = camera
        coordinator.draw(lines: lines, selected: selected, stretches: stretches, tint: tint, in: view)
        coordinator.show(callout, in: view)
        coordinator.show(pin, tint: tint, in: view)
        let contentInset = UIEdgeInsets(top: insets.top, left: insets.leading, bottom: insets.bottom, right: insets.trailing)
        let insetChanged = view.contentInset != contentInset
        if insetChanged { view.setContentInset(contentInset, animated: false, completionHandler: nil) }
        coordinator.frame(view, refit: insetChanged)
    }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency MLNMapViewDelegate, CLLocationManagerDelegate {
        var moved: (MKMapRect) -> Void = { _ in }
        var select: (UUID) -> Void = { _ in }
        var camera = CycleMap.Camera.automatic
        var pin: (center: CLLocationCoordinate2D, zoom: Double)?
        private var lines: [CycleMap.Line] = []
        private var selected: CycleMap.Line?
        private var stretches: [ResolvedStretch] = []
        private var tint = UIColor.systemGreen
        /// The camera last framed; the map only moves when `camera` differs from it.
        private var shown: CycleMap.Camera?
        /// The user has moved the map since it last framed `camera`, so a new safe area leaves it be.
        private var userMoved = false
        private var pinned = false
        private weak var mapView: MLNMapView?
        private let locationManager = CLLocationManager()
        private let calloutAnnotation = MLNPointAnnotation()
        private let calloutView = MLNAnnotationView(annotation: nil, reuseIdentifier: nil)
        private var calloutHost: UIHostingController<AnyView>?
        private let pinAnnotation = MLNPointAnnotation()
        private let pinView = MLNAnnotationView(annotation: nil, reuseIdentifier: nil)
        private var pinHost: UIHostingController<AnyView>?
        private var shownPin: CycleMap.Pin?

        private enum Layer {
            static let others = "ride-on-others", othersCasing = "ride-on-others-casing"
            static let selected = "ride-on-selected", selectedCasing = "ride-on-selected-casing"
            static let start = "ride-on-start", startDot = "ride-on-start-dot"
            static let stretches = "ride-on-stretches-"
            static let routes: Set<String> = [others, othersCasing, selected, selectedCasing]
        }

        func attach(_ mapView: MLNMapView) {
            self.mapView = mapView
            // Reports the current authorisation straight away, then every change.
            locationManager.delegate = self
        }

        // MARK: Camera

        /// Moves the camera to `camera` if it hasn't been shown yet, or again for a new safe area
        /// (`refit`) if the user hasn't moved the map. Waits for a laid-out view: a camera set on a
        /// zero-size view comes out at the wrong zoom.
        func frame(_ mapView: MLNMapView, refit: Bool = false) {
            guard !mapView.bounds.isEmpty, !pinned else { return }
            // The core map's size only catches up with the view's bounds in layoutSubviews.
            mapView.layoutIfNeeded()
            if let pin {
                mapView.setCenter(pin.center, zoomLevel: pin.zoom, animated: false)
                pinned = true
                return
            }
            guard camera != shown || (refit && !userMoved && shown != nil) else { return }
            let animated = shown != nil
            userMoved = false
            switch camera {
            case .userLocation where !mapView.showsUserLocation:
                // Every line until location is allowed, as MapKit's `.userLocation(fallback: .automatic)`;
                // `locationManagerDidChangeAuthorization` frames again then.
                guard shown != .automatic, fitLines(in: mapView, animated: animated) else { return }
                shown = .automatic
                return
            case .userLocation:
                mapView.setUserTrackingMode(.follow, animated: animated, completionHandler: nil)
            case .rect(let rect):
                fit(rect, in: mapView, animated: animated)
            case .automatic:
                guard fitLines(in: mapView, animated: animated) else { return }
            }
            shown = camera
        }

        /// Frames every line, if there are any.
        private func fitLines(in mapView: MLNMapView, animated: Bool) -> Bool {
            let box = (lines + [selected].compactMap { $0 }).flatMap(\.coordinates).reduce(MKMapRect.null) { box, coordinate in
                box.union(MKMapRect(origin: MKMapPoint(CLLocationCoordinate2D(coordinate)), size: MKMapSize(width: 0, height: 0)))
            }
            guard !box.isNull else { return false }
            fit(box.insetBy(dx: -box.width * 0.12, dy: -box.height * 0.12), in: mapView, animated: animated)
            return true
        }

        private func fit(_ rect: MKMapRect, in mapView: MLNMapView, animated: Bool) {
            if mapView.userTrackingMode != .none { mapView.setUserTrackingMode(.none, animated: false, completionHandler: nil) }
            let southWest = MKMapPoint(x: rect.minX, y: rect.maxY).coordinate
            let northEast = MKMapPoint(x: rect.maxX, y: rect.minY).coordinate
            mapView.setVisibleCoordinateBounds(MLNCoordinateBounds(sw: southWest, ne: northEast),
                                               edgePadding: .zero, animated: animated, completionHandler: nil)
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeWith reason: MLNCameraChangeReason, animated: Bool) {
            let gestures: MLNCameraChangeReason = [.gesturePan, .gesturePinch, .gestureRotate, .gestureZoomIn,
                                                   .gestureZoomOut, .gestureOneFingerZoom, .gestureTilt]
            guard !reason.isDisjoint(with: gestures) else { return }
            let bounds = mapView.convert(mapView.bounds.inset(by: mapView.contentInset), toCoordinateBoundsFrom: mapView)
            let (southWest, northEast) = (MKMapPoint(bounds.sw), MKMapPoint(bounds.ne))
            let rect = MKMapRect(x: southWest.x, y: northEast.y, width: northEast.x - southWest.x, height: southWest.y - northEast.y)
            // Already in view: handing it back as the camera mustn't move the map.
            shown = .rect(rect)
            userMoved = true
            camera = .rect(rect)
            moved(rect)
        }

        nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            let status = manager.authorizationStatus
            MainActor.assumeIsolated {
                // Not before: MLNMapView asks for permission itself when showing the user, and Ride On
                // asks through its own priming sheet.
                let allowed = status == .authorizedWhenInUse || status == .authorizedAlways
                guard let mapView, mapView.showsUserLocation != allowed else { return }
                mapView.showsUserLocation = allowed
                frame(mapView)
            }
        }

        // MARK: Lines

        func draw(lines: [CycleMap.Line], selected: CycleMap.Line?, stretches: [ResolvedStretch], tint: UIColor, in mapView: MLNMapView) {
            if stretches != self.stretches {
                self.stretches = stretches
                drawStretches(mapView)
            }
            guard lines != self.lines || selected != self.selected || tint != self.tint else { return }
            (self.lines, self.selected, self.tint) = (lines, selected, tint)
            redraw(mapView)
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            // Under the first label layer, so road and place names stay on top as on cycle.travel.
            let labels = style.layers.first { $0 is MLNSymbolStyleLayer }
            func insert(_ layer: MLNStyleLayer) {
                if let labels { style.insertLayer(layer, below: labels) } else { style.addLayer(layer) }
            }
            let sources = ["others", "selected", "start"].map { MLNShapeSource(identifier: "ride-on-\($0)", shape: nil) }
            sources.forEach(style.addSource)
            for (id, source, width, colour) in [(Layer.othersCasing, sources[0], 5.5, UIColor.black.withAlphaComponent(0.35)),
                                                (Layer.others, sources[0], 3.0, UIColor.white.withAlphaComponent(0.92)),
                                                (Layer.selectedCasing, sources[1], 9.5, UIColor.white),
                                                (Layer.selected, sources[1], 5.5, tint)] {
                insert(MLNLineStyleLayer(route: id, source: source, width: width, colour: colour))
            }
            // The start: a white disc with a hairline edge around a dot in the tint, as on `RoutesMap`.
            let start = MLNCircleStyleLayer(identifier: Layer.start, source: sources[2])
            start.circleRadius = NSExpression(forConstantValue: 10)
            start.circleColor = NSExpression(forConstantValue: UIColor.white)
            start.circleStrokeWidth = NSExpression(forConstantValue: 1)
            start.circleStrokeColor = NSExpression(forConstantValue: UIColor.black.withAlphaComponent(0.25))
            insert(start)
            let dot = MLNCircleStyleLayer(identifier: Layer.startDot, source: sources[2])
            dot.circleRadius = NSExpression(forConstantValue: 5)
            dot.circleColor = NSExpression(forConstantValue: tint)
            insert(dot)
            redraw(mapView)
            drawStretches(mapView)
            frame(mapView)
        }

        private func redraw(_ mapView: MLNMapView) {
            guard let style = mapView.style,
                  let others = style.source(withIdentifier: "ride-on-others") as? MLNShapeSource,
                  let selectedSource = style.source(withIdentifier: "ride-on-selected") as? MLNShapeSource,
                  let start = style.source(withIdentifier: "ride-on-start") as? MLNShapeSource else { return }
            others.shape = MLNShapeCollectionFeature(shapes: lines.map(Self.feature))
            selectedSource.shape = MLNShapeCollectionFeature(shapes: [selected].compactMap { $0 }.map(Self.feature))
            let marker = MLNPointFeature()
            if let first = selected?.coordinates.first { marker.coordinate = CLLocationCoordinate2D(first) }
            start.shape = selected?.coordinates.first == nil ? nil : marker
            for id in [Layer.selected, Layer.startDot] {
                switch style.layer(withIdentifier: id) {
                case let line as MLNLineStyleLayer:
                    line.lineColor = NSExpression(forConstantValue: tint)
                    line.lineOpacity = NSExpression(forConstantValue: stretches.isEmpty ? 1 : 0)
                case let circle as MLNCircleStyleLayer: circle.circleColor = NSExpression(forConstantValue: tint)
                default: break
                }
            }
        }

        /// The stretches over the selected line, under its start: a source and layer per colour, as
        /// there are only a handful (the wind's four effects).
        private func drawStretches(_ mapView: MLNMapView) {
            guard let style = mapView.style, let start = style.layer(withIdentifier: Layer.start) else { return }
            for layer in style.layers where layer.identifier.hasPrefix(Layer.stretches) { style.removeLayer(layer) }
            for source in style.sources where source.identifier.hasPrefix(Layer.stretches) { style.removeSource(source) }
            var colours: [UIColor] = []
            for stretch in stretches where !colours.contains(stretch.colour) { colours.append(stretch.colour) }
            for (index, colour) in colours.enumerated() {
                let shapes = stretches.filter { $0.colour == colour }.map { stretch in
                    var coordinates = stretch.coordinates.map(CLLocationCoordinate2D.init)
                    return MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
                }
                let source = MLNShapeSource(identifier: "\(Layer.stretches)\(index)", shape: MLNShapeCollectionFeature(shapes: shapes))
                style.addSource(source)
                style.insertLayer(MLNLineStyleLayer(route: source.identifier, source: source, width: 5.5, colour: colour), below: start)
            }
            if let line = style.layer(withIdentifier: Layer.selected) as? MLNLineStyleLayer {
                line.lineOpacity = NSExpression(forConstantValue: stretches.isEmpty ? 1 : 0)
            }
        }

        private static func feature(_ line: CycleMap.Line) -> MLNPolylineFeature {
            var coordinates = line.coordinates.map(CLLocationCoordinate2D.init)
            let feature = MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
            feature.attributes = ["id": line.id.uuidString]
            return feature
        }

        /// The drawn line closest to the tap, if one passes within 22pt of it (as `RoutesMap`).
        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let mapView = gesture.view as? MLNMapView else { return }
            let point = gesture.location(in: mapView)
            let near = mapView.visibleFeatures(in: CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44),
                                               styleLayerIdentifiers: Layer.routes)
            let ids = Set(near.compactMap { $0.attribute(forKey: "id") as? String })
            var nearest: (id: UUID, distance: CGFloat)?
            for line in lines + [selected].compactMap({ $0 }) where ids.contains(line.id.uuidString) {
                let points = line.coordinates.map { mapView.convert(CLLocationCoordinate2D($0), toPointTo: mapView) }
                let distance = zip(points, points.dropFirst()).map { Self.distance(from: point, toSegment: $0, $1) }.min() ?? .infinity
                if distance < 22, distance < (nearest?.distance ?? .infinity) { nearest = (line.id, distance) }
            }
            if let nearest { select(nearest.id) }
        }

        private static func distance(from p: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
            let (dx, dy) = (b.x - a.x, b.y - a.y)
            let length = dx * dx + dy * dy
            let t = length == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
            return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
        }

        // MARK: Callout

        /// Pins `content` above the selected line's northernmost point, or takes it away.
        func show(_ content: AnyView?, in mapView: MLNMapView) {
            guard let content, let top = selected?.coordinates.max(by: { $0.latitude < $1.latitude }) else {
                if mapView.annotations?.contains(where: { $0 === calloutAnnotation }) == true { mapView.removeAnnotation(calloutAnnotation) }
                return
            }
            if let calloutHost {
                calloutHost.rootView = content
            } else {
                let host = UIHostingController(rootView: content)
                host.view.backgroundColor = .clear
                calloutView.addSubview(host.view)
                calloutView.isEnabled = false
                calloutView.isUserInteractionEnabled = false
                calloutView.scalesWithViewingDistance = false
                calloutHost = host
            }
            let size = calloutHost!.sizeThatFits(in: UIView.layoutFittingExpandedSize)
            calloutView.bounds = CGRect(origin: .zero, size: size)
            calloutHost!.view.frame = calloutView.bounds
            // Its bottom edge on the point.
            calloutView.centerOffset = CGVector(dx: 0, dy: -size.height / 2)
            calloutAnnotation.coordinate = CLLocationCoordinate2D(top)
            if mapView.annotations?.contains(where: { $0 === calloutAnnotation }) != true { mapView.addAnnotation(calloutAnnotation) }
        }

        /// Puts the pin on its point, or takes it away.
        func show(_ pin: CycleMap.Pin?, tint: UIColor, in mapView: MLNMapView) {
            guard pin != shownPin else { return }
            shownPin = pin
            guard let pin else {
                if mapView.annotations?.contains(where: { $0 === pinAnnotation }) == true { mapView.removeAnnotation(pinAnnotation) }
                return
            }
            let content = AnyView(RoutePin(pin.label).tint(Color(uiColor: tint)))
            if let pinHost {
                pinHost.rootView = content
            } else {
                let host = UIHostingController(rootView: content)
                host.view.backgroundColor = .clear
                pinView.addSubview(host.view)
                pinView.isEnabled = false
                pinView.isUserInteractionEnabled = false
                pinView.scalesWithViewingDistance = false
                pinHost = host
            }
            let size = pinHost!.sizeThatFits(in: UIView.layoutFittingExpandedSize)
            pinView.bounds = CGRect(origin: .zero, size: size)
            pinHost!.view.frame = pinView.bounds
            // The dot's centre on the point.
            pinView.centerOffset = CGVector(dx: 0, dy: -(size.height / 2 - RoutePin.anchor))
            pinAnnotation.coordinate = CLLocationCoordinate2D(pin.coordinate)
            if mapView.annotations?.contains(where: { $0 === pinAnnotation }) != true { mapView.addAnnotation(pinAnnotation) }
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: any MLNAnnotation) -> MLNAnnotationView? {
            if annotation === calloutAnnotation { return calloutView }
            if annotation === pinAnnotation { return pinView }
            return nil
        }

        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: any Error) {
            print("CycleMap: map failed to load: \(error)")
        }
    }
}

extension MLNLineStyleLayer {
    /// A route, or its casing: a constant width and colour, round at the ends and corners.
    convenience init(route identifier: String, source: MLNSource, width: Double, colour: UIColor) {
        self.init(identifier: identifier, source: source)
        lineWidth = NSExpression(forConstantValue: width)
        lineColor = NSExpression(forConstantValue: colour)
        lineCap = NSExpression(forConstantValue: "round")
        lineJoin = NSExpression(forConstantValue: "round")
    }
}

extension CLLocationCoordinate2D {
    init(_ coordinate: Coordinate) {
        self.init(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}
#endif

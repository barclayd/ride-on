#if os(iOS)
import SwiftUI
import MapKit
import MapLibre
import Models

/// WS3.0 spike (docs/maps/README.md): the cycle map's basemap in MapLibre Native, standing in for
/// the Routes map when the app is launched with `--cycle-map`. Throwaway: WS3.2 replaces it with
/// `CycleMap` in SharedUI (DESIGN-SYSTEM.md §6 #17).
///
/// The style is the production one, basemap and cycling overlay, built by `maps/style` into
/// `CycleMap/` with its glyphs. Routes are style layers under the labels, the way `CycleMap` will
/// draw them.
struct CycleMapSpike: UIViewRepresentable {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("--cycle-map") }

    var routes: [RouteLibrary.Route]
    var selected: RouteLibrary.Route?
    var accent: UIColor
    /// Framed when it changes; the user's own panning is left alone in between. Nil (the camera is on
    /// `.userLocation(fallback: .automatic)`) frames every drawn route, as `.automatic` does in MapKit.
    var frame: MKMapRect?
    /// The SwiftUI safe area (status bar, the panel), as content insets: the view itself fills the
    /// screen and draws under them, like `Map`.
    var insets: EdgeInsets
    var select: (UUID) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        MLNLoggingConfiguration.shared.loggingLevel = .info
        let view = MLNMapView(frame: .zero, styleURL: Self.styleURL)
        view.delegate = context.coordinator
        view.automaticallyAdjustsContentInset = false
        view.logoView.isHidden = true
        view.compassView.compassVisibility = .hidden
        // MLNMapView asks for location permission itself when showing the user; Ride On asks through
        // its own priming sheet, so only show the dot once that has been granted.
        view.showsUserLocation = [.authorizedWhenInUse, .authorizedAlways].contains(CLLocationManager().authorizationStatus)
        view.setCenter(CLLocationCoordinate2D(latitude: 51.4455, longitude: -0.2665), zoomLevel: 11, animated: false)
        view.accessibilityIdentifier = "cycle-map"
        // `-CycleMapCamera 51.4455,-0.2665,14` pins the camera (latitude, longitude, zoom) for
        // screenshots against the prototype; framing is then skipped.
        if let camera = UserDefaults.standard.string(forKey: "CycleMapCamera")?.split(separator: ",").compactMap({ Double($0) }),
           camera.count == 3 {
            context.coordinator.pin = (CLLocationCoordinate2D(latitude: camera[0], longitude: camera[1]), camera[2])
        }
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped)))
        return view
    }

    func updateUIView(_ view: MLNMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.all = routes + [selected].compactMap { $0 }
        coordinator.routes = routes.filter { $0.id != selected?.id }.map(\.locations)
        coordinator.selected = selected?.locations
        coordinator.accent = accent
        coordinator.select = select
        coordinator.frame = frame ?? Self.automatic(coordinator.all)
        let contentInset = UIEdgeInsets(top: insets.top, left: insets.leading, bottom: insets.bottom, right: insets.trailing)
        if view.contentInset != contentInset { view.setContentInset(contentInset, animated: false, completionHandler: nil) }
        coordinator.redraw(view)
        coordinator.applyFrame(view)
    }

    private static func automatic(_ routes: [RouteLibrary.Route]) -> MKMapRect? {
        let box = routes.flatMap(\.locations).reduce(MKMapRect.null) { box, location in
            box.union(MKMapRect(origin: MKMapPoint(location), size: MKMapSize(width: 0, height: 0)))
        }
        return box.isNull ? nil : box.insetBy(dx: -box.width * 0.12, dy: -box.height * 0.12)
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        var all: [RouteLibrary.Route] = []
        var select: (UUID) -> Void = { _ in }
        var routes: [[CLLocationCoordinate2D]] = []
        var selected: [CLLocationCoordinate2D]?
        var accent: UIColor = .systemGreen
        var frame: MKMapRect?
        var pin: (center: CLLocationCoordinate2D, zoom: Double)?
        private var pinned = false
        private var framed: MKMapRect?

        /// Waits for a laid-out view: a camera set on a zero-size view comes out at the wrong zoom.
        func applyFrame(_ mapView: MLNMapView) {
            guard !mapView.bounds.isEmpty, !pinned else { return }
            // The core map's size only catches up with the view's bounds in layoutSubviews.
            mapView.layoutIfNeeded()
            if let pin {
                mapView.setCenter(pin.center, zoomLevel: pin.zoom, animated: false)
                pinned = true
                return
            }
            guard let frame, framed.map({ MKMapRectEqualToRect($0, frame) }) != true else { return }
            let animated = framed != nil
            framed = frame
            let southWest = MKMapPoint(x: frame.minX, y: frame.maxY).coordinate
            let northEast = MKMapPoint(x: frame.maxX, y: frame.minY).coordinate
            mapView.setVisibleCoordinateBounds(MLNCoordinateBounds(sw: southWest, ne: northEast),
                                               edgePadding: .zero, animated: animated, completionHandler: nil)
        }

        func mapViewDidFinishLoadingMap(_ mapView: MLNMapView) { applyFrame(mapView) }

        func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: any Error) {
            print("CycleMapSpike: map failed to load: \(error)")
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            // Under the first label layer, so road and place names stay on top as on cycle.travel.
            let labels = style.layers.first { $0 is MLNSymbolStyleLayer }
            for (id, width, colour) in [("others-casing", 5.5, UIColor.black.withAlphaComponent(0.35)),
                                        ("others", 3.0, UIColor.white.withAlphaComponent(0.92)),
                                        ("selected-casing", 9.5, UIColor.white),
                                        ("selected", 5.5, accent)] {
                let source = style.source(withIdentifier: id.hasPrefix("others") ? "others" : "selected")
                    ?? Self.addSource(id.hasPrefix("others") ? "others" : "selected", to: style)
                let layer = MLNLineStyleLayer(identifier: id, source: source)
                layer.lineWidth = NSExpression(forConstantValue: width)
                layer.lineColor = NSExpression(forConstantValue: colour)
                layer.lineCap = NSExpression(forConstantValue: "round")
                layer.lineJoin = NSExpression(forConstantValue: "round")
                if let labels { style.insertLayer(layer, below: labels) } else { style.addLayer(layer) }
            }
            redraw(mapView)
            applyFrame(mapView)
        }

        func redraw(_ mapView: MLNMapView) {
            guard let style = mapView.style,
                  let others = style.source(withIdentifier: "others") as? MLNShapeSource,
                  let selectedSource = style.source(withIdentifier: "selected") as? MLNShapeSource else { return }
            others.shape = MLNShapeCollectionFeature(shapes: routes.map(Self.line))
            selectedSource.shape = MLNShapeCollectionFeature(shapes: [selected].compactMap { $0 }.map(Self.line))
            (style.layer(withIdentifier: "selected") as? MLNLineStyleLayer)?.lineColor = NSExpression(forConstantValue: accent)
        }

        /// The drawn route closest to the tap, if one passes within 22pt of it (as `RoutesMap`).
        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let mapView = gesture.view as? MLNMapView else { return }
            let point = gesture.location(in: mapView)
            var nearest: (id: UUID, distance: CGFloat)?
            for route in all {
                let points = route.locations.map { mapView.convert($0, toPointTo: mapView) }
                let distance = zip(points, points.dropFirst()).map { Self.distance(from: point, toSegment: $0, $1) }.min() ?? .infinity
                if distance < 22, distance < (nearest?.distance ?? .infinity) { nearest = (route.id, distance) }
            }
            if let nearest { select(nearest.id) }
        }

        private static func distance(from p: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
            let (dx, dy) = (b.x - a.x, b.y - a.y)
            let length = dx * dx + dy * dy
            let t = length == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
            return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
        }

        private static func addSource(_ id: String, to style: MLNStyle) -> MLNSource {
            let source = MLNShapeSource(identifier: id, shape: nil)
            style.addSource(source)
            return source
        }

        private static func line(_ coordinates: [CLLocationCoordinate2D]) -> MLNPolylineFeature {
            var coordinates = coordinates
            return MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
        }
    }

    /// The bundled style with `bundle://` pointed at the resource bundle. Native needs absolute glyph
    /// URLs, so the style is rewritten once into Caches. `-CycleMapTiles <url>` swaps the tile host,
    /// e.g. `file:///…/tiles` for a folder holding local `basemap-gb-*.pmtiles` and `cycling-gb-*.pmtiles`.
    private static let styleURL: URL = {
        let directory = Bundle.module.url(forResource: "CycleMap", withExtension: nil)!
        var json = try! String(contentsOf: directory.appending(path: "style.json"), encoding: .utf8)
            .replacingOccurrences(of: "bundle://", with: directory.absoluteString)
        if let tiles = UserDefaults.standard.string(forKey: "CycleMapTiles") {
            json = json.replacingOccurrences(of: "https://maps.ride-on.cc", with: tiles)
        }
        let url = URL.cachesDirectory.appending(path: "cycle-map-style.json")
        try! json.write(to: url, atomically: true, encoding: .utf8)
        return url
    }()
}
#endif

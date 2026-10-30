#if os(iOS)
import SwiftUI
import MapKit
import MapLibre
import Models
import DesignSystem

/// `CycleMap` as a still image (DESIGN-SYSTEM.md §6 #17), for a Routes shortlist card or a thumbnail:
/// lists never hold live maps. `MLNMapSnapshotter` draws the route on the cycle map once per route,
/// framing, look, tint, size and scale, and the image is kept in memory. Until it's ready, or if it
/// fails, the route is drawn on the map's land colour exactly where the snapshot puts it.
///
/// Without labels, as the satellite cards were: the card's own text sits over it, and a still render
/// fails outright on any missing resource, such as the glyphs for a name in a script the bundled
/// Montserrat ranges don't cover.
struct CycleMapSnapshot: View {
    enum Look: Hashable {
        /// A shortlist card's: the route with its start marked, as `RouteMap`'s card.
        case card
        /// A list row's: the line alone.
        case thumbnail
    }

    var coordinates: [Coordinate]
    /// Fitted inside the view, aspect intact, as `Map(initialPosition: .rect(_:))` does.
    var framing: MKMapRect
    var look: Look
    var tint: Color.Resolved

    @Environment(\.displayScale) private var scale
    @State private var loaded: (request: SnapshotRequest, image: UIImage)?

    var body: some View {
        GeometryReader { geometry in
            let request = SnapshotRequest(coordinates: coordinates, framing: framing, look: look, tint: tint,
                                          size: geometry.size, scale: scale)
            let image = loaded?.request == request ? loaded?.image : CycleMapSnapshots.shared.cached(request)
            ZStack {
                SnapshotPlaceholder(request: request, size: geometry.size)
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .transition(.opacity)
                }
            }
            .task(id: request) {
                guard image == nil, let image = await CycleMapSnapshots.shared.image(for: request) else { return }
                withAnimation(Motion.panelMaterialize) { loaded = (request, image) }
            }
        }
    }
}

/// Everything that changes the image.
struct SnapshotRequest: Hashable {
    var coordinates: [Coordinate]
    var framing: Rect
    var look: CycleMapSnapshot.Look
    var tint: Tint
    /// In whole points.
    var width: Double
    var height: Double
    var scale: Double

    struct Rect: Hashable {
        var x, y, width, height: Double

        var mapRect: MKMapRect { MKMapRect(x: x, y: y, width: width, height: height) }
    }

    /// In 8-bit steps, as the image holds it: resolving the same colour twice can differ in the last bit.
    struct Tint: Hashable {
        var red, green, blue, opacity: Int

        init(_ resolved: Color.Resolved) {
            (red, green, blue, opacity) = (Self.step(resolved.red), Self.step(resolved.green), Self.step(resolved.blue), Self.step(resolved.opacity))
        }

        var color: Color {
            Color(Color.Resolved(red: Float(red) / 255, green: Float(green) / 255, blue: Float(blue) / 255, opacity: Float(opacity) / 255))
        }

        private static func step(_ component: Float) -> Int { Int((component * 255).rounded()) }
    }

    init(coordinates: [Coordinate], framing: MKMapRect, look: CycleMapSnapshot.Look, tint: Color.Resolved,
         size: CGSize, scale: CGFloat) {
        self.coordinates = coordinates
        // A route running due north or due east frames a line: square it up.
        let side = max(framing.width, framing.height)
        let framing = framing.width > 0 && framing.height > 0 || framing.isNull ? framing
            : MKMapRect(x: framing.midX - side / 2, y: framing.midY - side / 2, width: side, height: side)
        self.framing = framing.isNull ? Rect(x: 0, y: 0, width: 0, height: 0)
            : Rect(x: framing.minX, y: framing.minY, width: framing.width, height: framing.height)
        self.look = look
        self.tint = Tint(tint)
        (width, height) = (size.width.rounded(.up), size.height.rounded(.up))
        self.scale = scale
    }

    var isDrawable: Bool { coordinates.count > 1 && width >= 1 && height >= 1 && framing.width > 0 && framing.height > 0 }

    /// The line and casing widths, and the start marker's diameter and ring, as `RouteMap` draws them.
    var line: (width: Double, casing: Double) { look == .card ? (4, 7) : (3.5, 6.5) }
    static let marker = (diameter: 12.0, ring: 2.5)

    /// MapLibre draws nothing smaller than 64pt a side, so a thumbnail is drawn larger at a lower
    /// scale: the same pixels, its lines widened to match.
    var enlarged: Double { max(1, 64 / min(width, height)) }
}

/// Snapshots by request, kept while memory allows. At most two render at once; one asked for by a row
/// that has since scrolled away is skipped.
@MainActor
final class CycleMapSnapshots {
    static let shared = CycleMapSnapshots()

    private let cache = NSCache<Key, UIImage>()
    private var rendering: [SnapshotRequest: Task<UIImage?, Never>] = [:]
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []

    private init() {
        // About 30 cards at 3×.
        cache.totalCostLimit = 48 << 20
    }

    func cached(_ request: SnapshotRequest) -> UIImage? {
        cache.object(forKey: Key(request))
    }

    func image(for request: SnapshotRequest) async -> UIImage? {
        guard request.isDrawable else { return nil }
        if let image = cached(request) { return image }
        if let render = rendering[request] { return await render.value }
        await slot()
        guard !Task.isCancelled else {
            release()
            return nil
        }
        // Drawn, or being drawn, for another view while this one waited.
        if let image = cached(request) {
            release()
            return image
        }
        if let render = rendering[request] {
            release()
            return await render.value
        }
        // Not tied to the view's task: once started, it finishes and is kept for next time.
        let render = Task {
            let image = await SnapshotRender(request).image()
            if let image {
                cache.setObject(image, forKey: Key(request), cost: Int(request.width * request.height * request.scale * request.scale * 4))
            }
            rendering[request] = nil
            release()
            return image
        }
        rendering[request] = render
        return await render.value
    }

    private func slot() async {
        if running < 2 {
            running += 1
        } else {
            await withCheckedContinuation { waiting.append($0) }
        }
    }

    /// Hands the slot to the next waiting, or frees it.
    private func release() {
        if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
    }

    private final class Key: NSObject {
        let request: SnapshotRequest

        init(_ request: SnapshotRequest) {
            self.request = request
        }

        override var hash: Int { request.hashValue }

        override func isEqual(_ object: Any?) -> Bool {
            (object as? Key)?.request == request
        }
    }
}

/// The cycle map alone, no route, for the widget's stills (docs/redesign/README.md §8): the widget
/// draws the loop over it, so its progress can move without a new image. Not cached: the app saves it.
public enum CycleMapStill {
    @MainActor
    public static func image(framing: MKMapRect, size: CGSize, scale: CGFloat) async -> UIImage? {
        let request = SnapshotRequest(coordinates: [], framing: framing, look: .thumbnail,
                                      tint: Color.clear.resolve(in: EnvironmentValues()), size: size, scale: scale)
        return await SnapshotRender(request).image()
    }
}

/// One `MLNMapSnapshotter` run, its delegate: the route is added once the style has loaded. Held by
/// `image()` until the snapshot is done, since the snapshotter holds its delegate weakly.
@MainActor
private final class SnapshotRender: NSObject, @preconcurrency MLNMapSnapshotterDelegate {
    private let request: SnapshotRequest
    private var snapshotter: MLNMapSnapshotter?

    init(_ request: SnapshotRequest) {
        self.request = request
    }

    func image() async -> UIImage? {
        let framing = request.framing.mapRect
        let options = MLNMapSnapshotOptions(styleURL: CycleMap.styleURL, camera: MLNMapCamera(),
                                            size: CGSize(width: request.width * request.enlarged, height: request.height * request.enlarged))
        options.coordinateBounds = MLNCoordinateBounds(sw: MKMapPoint(x: framing.minX, y: framing.maxY).coordinate,
                                                       ne: MKMapPoint(x: framing.maxX, y: framing.minY).coordinate)
        options.scale = request.scale / request.enlarged
        // A card carries the attribution itself, clear of its title (§2); a thumbnail is too small for it.
        options.showsLogo = false
        options.showsAttribution = false
        let snapshotter = MLNMapSnapshotter(options: options)
        snapshotter.delegate = self
        self.snapshotter = snapshotter
        return await withCheckedContinuation { continuation in
            snapshotter.start { snapshot, error in
                if let error { print("CycleMap: snapshot failed: \(error)") }
                continuation.resume(returning: snapshot?.image)
            }
        }
    }

    func mapSnapshotter(_ snapshotter: MLNMapSnapshotter, didFinishLoading style: MLNStyle) {
        // Nor terrain: at a card's size the shading and contours are noise under its text.
        for layer in style.layers where layer is MLNSymbolStyleLayer || layer is MLNHillshadeStyleLayer
            || layer.identifier.hasPrefix("ct_contour") {
            layer.isVisible = false
        }
        guard !request.coordinates.isEmpty else { return }
        let (tint, enlarged) = (UIColor(request.tint.color), request.enlarged)
        var coordinates = request.coordinates.map(CLLocationCoordinate2D.init)
        // As given: a still render otherwise simplifies a loop's curves into corners.
        let route = MLNShapeSource(identifier: "ride-on-route",
                                   shape: MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count)),
                                   options: [.simplificationTolerance: 0])
        style.addSource(route)
        style.addLayer(MLNLineStyleLayer(route: "ride-on-route-casing", source: route, width: request.line.casing * enlarged, colour: .white))
        style.addLayer(MLNLineStyleLayer(route: "ride-on-route", source: route, width: request.line.width * enlarged, colour: tint))
        if request.look == .card {
            let point = MLNPointFeature()
            point.coordinate = coordinates[0]
            let source = MLNShapeSource(identifier: "ride-on-start", shape: point)
            style.addSource(source)
            // A circle's stroke is outside its radius; SwiftUI's is centred on the edge.
            let start = MLNCircleStyleLayer(identifier: "ride-on-start", source: source)
            start.circleRadius = NSExpression(forConstantValue: (SnapshotRequest.marker.diameter - SnapshotRequest.marker.ring) / 2 * enlarged)
            start.circleColor = NSExpression(forConstantValue: tint)
            start.circleStrokeWidth = NSExpression(forConstantValue: SnapshotRequest.marker.ring * enlarged)
            start.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
            style.addLayer(start)
        }
    }

    func mapSnapshotterDidFail(_ snapshotter: MLNMapSnapshotter, withError error: any Error) {
        print("CycleMap: snapshot style failed to load: \(error)")
    }
}

/// The route on the map's land colour, projected as the snapshot projects it: Web Mercator, the
/// framing fitted and centred.
private struct SnapshotPlaceholder: View {
    var request: SnapshotRequest
    var size: CGSize

    var body: some View {
        let points = projected
        let route = Path { $0.addLines(points) }
        let tint = request.tint.color
        let stroke = { (width: Double) in StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round) }
        ZStack(alignment: .topLeading) {
            CycleMap.land
            route.stroke(.white, style: stroke(request.line.casing))
            route.stroke(tint, style: stroke(request.line.width))
            if request.look == .card, let start = points.first {
                Circle()
                    .fill(tint)
                    .stroke(.white, lineWidth: SnapshotRequest.marker.ring)
                    .frame(width: SnapshotRequest.marker.diameter, height: SnapshotRequest.marker.diameter)
                    .position(start)
            }
        }
    }

    private var projected: [CGPoint] {
        let framing = request.framing.mapRect
        guard request.isDrawable else { return [] }
        let scale = min(size.width / framing.width, size.height / framing.height)
        return request.coordinates.map {
            let point = MKMapPoint(CLLocationCoordinate2D($0))
            return CGPoint(x: (point.x - framing.midX) * scale + size.width / 2, y: (point.y - framing.midY) * scale + size.height / 2)
        }
    }
}
#endif

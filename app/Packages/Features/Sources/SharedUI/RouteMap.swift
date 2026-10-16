import SwiftUI
import DesignSystem
import MapKit
import Models

/// One route drawn in the accent on a white casing. Not a §6 component. The hero is a
/// non-interactive `Map`, which keeps the Maps attribution visible (§2); a thumbnail is just
/// the route's outline on a plain fill, as on the canvas, since a 56pt map is all labels and
/// Legal link.
public struct RouteMap: View {
    public enum Style {
        /// Satellite imagery with a start marker; the route sits in the band between the
        /// toolbar and the hero's title block.
        case hero
        /// The hero's look, smaller, for a Routes shortlist card: the route sits above the
        /// card's title block.
        case card
        /// The route's outline, centred on a plain fill.
        case thumbnail
    }

    var coordinates: [CLLocationCoordinate2D]
    var style: Style
    var tint: Color
    @Environment(\.self) private var environment

    public init(_ coordinates: [Coordinate], style: Style, tint: Color = .accentColor) {
        self.coordinates = coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        self.style = style
        self.tint = tint
    }

    public var body: some View {
        switch style {
        case .hero, .card: map
        case .thumbnail: outline
        }
    }

    private var outline: some View {
        let shape = RouteOutline(coordinates: coordinates, inset: 0.16)
        let line = StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round)
        return ZStack {
            shape.stroke(.routeCasing, style: StrokeStyle(lineWidth: 6.5, lineCap: .round, lineJoin: .round))
            shape.stroke(tint, style: line)
        }
        .background(.routeLand)
    }

    private var map: some View {
        // Resolved here: `Map` content drops back to system blue for `.accentColor` once it
        // re-renders with a new route.
        let resolved = tint.resolve(in: environment)
        let tint = Color(resolved)
        let (lineWidth, marker, ring): (CGFloat, CGFloat, CGFloat) = style == .card ? (4, 12, 2.5) : (5, 16, 3)
        return Map(initialPosition: .rect(framingRect), interactionModes: []) {
            MapPolyline(coordinates: coordinates)
                .stroke(.white, style: StrokeStyle(lineWidth: lineWidth + 3, lineCap: .round, lineJoin: .round))
            // Keyed on its colour: a polyline keeps its first stroke, so the tint dimmed behind a
            // sheet would otherwise stay once the sheet has gone.
            ForEach([resolved], id: \.self) { _ in
                MapPolyline(coordinates: coordinates)
                    .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
            }
            if let start = coordinates.first {
                Annotation("Start", coordinate: start) {
                    Circle()
                        .fill(tint)
                        .stroke(.white, lineWidth: ring)
                        .frame(width: marker, height: marker)
                }
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.imagery)
    }

    /// The route's bounding box grown by per-edge margins (fractions of the final rect), so it
    /// sits clear of the toolbar and the title block.
    private var framingRect: MKMapRect {
        let box = coordinates.reduce(MKMapRect.null) { box, coordinate in
            box.union(MKMapRect(origin: MKMapPoint(coordinate), size: MKMapSize(width: 0, height: 0)))
        }
        let (top, bottom, side) = style == .card ? (0.08, 0.49, 0.2) : (0.28, 0.40, 0.14)
        let width = box.width / (1 - 2 * side)
        let height = box.height / (1 - top - bottom)
        return MKMapRect(x: box.minX - side * width, y: box.minY - top * height, width: width, height: height)
    }
}

/// The route's points projected flat (longitude scaled by latitude) and fitted, aspect intact,
/// inside the rect less `inset` on every side.
private struct RouteOutline: Shape {
    var coordinates: [CLLocationCoordinate2D]
    var inset: CGFloat

    func path(in rect: CGRect) -> Path {
        guard let first = coordinates.first else { return Path() }
        let scale = cos(first.latitude * .pi / 180)
        let points = coordinates.map { CGPoint(x: $0.longitude * scale, y: -$0.latitude) }
        let xs = points.map(\.x), ys = points.map(\.y)
        let box = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        let frame = rect.insetBy(dx: rect.width * inset, dy: rect.height * inset)
        let fit = min(frame.width / max(box.width, .ulpOfOne), frame.height / max(box.height, .ulpOfOne))
        let origin = CGPoint(x: frame.midX - box.width * fit / 2, y: frame.midY - box.height * fit / 2)
        var path = Path()
        path.addLines(points.map { CGPoint(x: origin.x + ($0.x - box.minX) * fit, y: origin.y + ($0.y - box.minY) * fit) })
        return path
    }
}

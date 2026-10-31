import SwiftUI
import MapKit
import Models

/// §6: a route coloured by the wind's effect along it, on a muted, non-interactive map, like a
/// Fitness workout's route. Where the road is ridden twice, the return is drawn beside the way
/// out, as on a transit map, so both colours show. On iOS the map is a muted `CycleMap` snapshot
/// (§6 #17) with the route drawn over it, so a new wind needs no new image; the Mac stays on MapKit.
public struct WindRouteMap: View {
    public struct Run: Hashable {
        /// Shares of the distance, 0–1.
        public var from: Double
        public var to: Double
        public var color: Color

        public init(from: Double, to: Double, color: Color) {
            self.from = from
            self.to = to
            self.color = color
        }
    }

    var points: [MKMapPoint]
    var runs: [Run]
    var showsFinish: Bool
    @Environment(\.self) private var environment

    /// Points every 1/`samples` of the way: enough for a card-sized map, few enough to compare.
    private static let samples = 300
    /// The return's distance from the way out, in points.
    private static let offset = 3.0

    public init(_ coordinates: [Coordinate], runs: [Run], showsFinish: Bool) {
        self.points = RouteTrace(coordinates).resampled(Self.samples)
            .map { MKMapPoint(CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)) }
        self.runs = runs
        self.showsFinish = showsFinish
    }

    public var body: some View {
        GeometryReader { proxy in
            #if os(iOS)
            cycleMap(framingRect, size: proxy.size)
            #else
            mapKit(framingRect, size: proxy.size)
            #endif
        }
    }

    #if os(iOS)
    /// The route drawn where the snapshot puts it, over the map kept light as the cycle map always is.
    private func cycleMap(_ rect: MKMapRect, size: CGSize) -> some View {
        // The snapshot fits the whole rect, centred, so the tighter axis sets the scale.
        let scale = min(size.width / max(rect.width, .ulpOfOne), size.height / max(rect.height, .ulpOfOne))
        let line = Self.besideRetraced(points, by: Self.offset / scale).map {
            CGPoint(x: ($0.x - rect.midX) * scale + size.width / 2, y: ($0.y - rect.midY) * scale + size.height / 2)
        }
        let stroke = { (width: CGFloat) in StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round) }
        return ZStack(alignment: .topLeading) {
            CycleMapSnapshot(coordinates: [], framing: rect, look: .muted, tint: Color.Resolved(red: 0, green: 0, blue: 0))
            Path { $0.addLines(line) }
                .stroke(.white, style: stroke(7))
            ForEach(runs, id: \.self) { run in
                Path { $0.addLines(slice(line, run.from, run.to)) }
                    .stroke(run.color, style: stroke(4))
            }
            if let start = line.first {
                marker(fill: .white, ring: .black)
                    .overlay(alignment: .top) { title("Start") }
                    .position(start)
            }
            if showsFinish, let finish = line.last {
                // Untitled when it would sit on the start's title, as MapKit drops a colliding one.
                let titled = line.first.map { hypot(finish.x - $0.x, finish.y - $0.y) > 44 } ?? true
                marker(fill: .black, ring: .white)
                    .overlay(alignment: .top) { if titled { title("Finish") } }
                    .position(finish)
            }
        }
        .overlay(alignment: .bottomLeading) {
            CycleMapAttribution()
                .padding(.leading, 12)
                .padding(.bottom, 4)
        }
        .environment(\.colorScheme, .light)
    }

    /// Under its marker, haloed, as MapKit titles an annotation.
    private func title(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.black.opacity(0.8))
            .shadow(color: .white, radius: 1)
            .shadow(color: .white, radius: 1)
            .fixedSize()
            .offset(y: 14)
            // Chrome over the map, held at a fixed size like the credit.
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }
    #else
    private func mapKit(_ rect: MKMapRect, size: CGSize) -> some View {
        // `.rect` fits the whole rect, so the tighter axis sets the scale.
        let perPoint = max(rect.width / max(size.width, 1), rect.height / max(size.height, 1))
        let line = Self.besideRetraced(points, by: Self.offset * perPoint).map(\.coordinate)
        return Map(initialPosition: .rect(rect), interactionModes: []) {
            MapPolyline(coordinates: line)
                .stroke(.white, style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
            // Keyed on the run and its colour: a polyline keeps its first stroke.
            ForEach(lines, id: \.self) { run in
                MapPolyline(coordinates: slice(line, run.from, run.to))
                    .stroke(Color(run.color), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
            if let start = line.first {
                Annotation("Start", coordinate: start) { marker(fill: .white, ring: .black) }
            }
            if showsFinish, let finish = line.last {
                Annotation("Finish", coordinate: finish) { marker(fill: .black, ring: .white) }
            }
        }
        .mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))
    }

    private struct Line: Hashable {
        var from: Double
        var to: Double
        var color: Color.Resolved
    }

    /// Resolved here: `Map` content drops back to system blue for `.accentColor`.
    private var lines: [Line] {
        runs.map { Line(from: $0.from, to: $0.to, color: $0.color.resolve(in: environment)) }
    }
    #endif

    private func marker(fill: Color, ring: Color) -> some View {
        Circle()
            .fill(fill)
            .stroke(ring.opacity(0.6), lineWidth: 1.5)
            .frame(width: 11, height: 11)
    }

    /// The samples from `from` to `to` of the way along; neighbouring runs share their end sample.
    private func slice<Point>(_ line: [Point], _ from: Double, _ to: Double) -> [Point] {
        guard line.count > 1 else { return line }
        let last = Double(line.count - 1)
        let lower = Int((from * last).rounded(.down)), upper = Int((to * last).rounded(.up))
        return Array(line[max(0, lower)...min(line.count - 1, max(upper, lower + 1))])
    }

    /// Where the line comes back within `offset` of a part ridden at least a tenth of the way
    /// earlier, it moves `offset` to the right of its direction.
    static func besideRetraced(_ points: [MKMapPoint], by offset: Double) -> [MKMapPoint] {
        let count = points.count
        guard count > 2, offset > 0 else { return points }
        let earlier = Int((0.1 * Double(count - 1)).rounded(.up))
        func near(_ p: MKMapPoint, _ a: MKMapPoint, _ b: MKMapPoint) -> Bool {
            let dx = b.x - a.x, dy = b.y - a.y
            let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / max(dx * dx + dy * dy, .ulpOfOne)))
            return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < offset
        }
        return points.indices.map { i in
            guard i > earlier, (0..<(i - earlier)).contains(where: { near(points[i], points[$0], points[$0 + 1]) }) else { return points[i] }
            let a = points[max(0, i - 1)], b = points[min(count - 1, i + 1)]
            let length = max(hypot(b.x - a.x, b.y - a.y), .ulpOfOne)
            return MKMapPoint(x: points[i].x - (b.y - a.y) / length * offset, y: points[i].y + (b.x - a.x) / length * offset)
        }
    }

    /// The route's bounding box with room round it for the markers' titles.
    private var framingRect: MKMapRect {
        let box = points.reduce(MKMapRect.null) { $0.union(MKMapRect(origin: $1, size: MKMapSize(width: 0, height: 0))) }
        let side = 0.12, top = 0.12, bottom = 0.2
        let width = box.width / (1 - 2 * side), height = box.height / (1 - top - bottom)
        return MKMapRect(x: box.minX - side * width, y: box.minY - top * height, width: width, height: height)
    }
}

#Preview {
    let pick = RideBoard.sample.picks[0]
    WindRouteMap(pick.route.coordinates, runs: [
        .init(from: 0, to: 0.5, color: .orange), .init(from: 0.5, to: 0.8, color: .accentColor), .init(from: 0.8, to: 1, color: .red),
    ], showsFinish: false)
    .frame(height: 180)
}

import SwiftUI
import MapKit
import Models
import DesignSystem

/// The map's look, from the map controls' style menu.
enum MapLook: String, CaseIterable, Identifiable {
    case satellite, hybrid, standard

    var id: Self { self }

    var title: String {
        switch self {
        case .satellite: "Satellite"
        case .hybrid: "Hybrid"
        case .standard: "Standard"
        }
    }

    var style: MapStyle {
        switch self {
        case .satellite: .imagery
        case .hybrid: .hybrid
        case .standard: .standard
        }
    }
}

/// The Routes tab's full-screen map: the shortlist's loops in white, the selected route in the
/// accent with its start marked, and a callout naming it. Tapping near a route selects it.
struct RoutesMap: View {
    /// Drawn white; the selected one is drawn in the accent instead.
    var routes: [RouteLibrary.Route]
    var selected: RouteLibrary.Route?
    /// "51 km" or the ride's date, beside the name; nil hides the callout.
    var calloutDetail: String?
    @Binding var camera: MapCameraPosition
    var look: MapLook
    var select: (UUID) -> Void

    @Environment(\.self) private var environment

    var body: some View {
        // Resolved, and the selected route keyed on it: `Map` content keeps its first stroke and
        // drops back to system blue for `.accentColor` (see `RouteMap`).
        let accent = Color.accentColor.resolve(in: environment)
        #if os(iOS)
        if CycleMapSpike.isEnabled {
            GeometryReader { geometry in
                CycleMapSpike(routes: routes, selected: selected, accent: UIColor(Color(accent)), frame: camera.rect,
                              insets: geometry.safeAreaInsets, select: select)
                    .ignoresSafeArea()
            }
        } else {
            mapKit(accent: accent)
        }
        #else
        mapKit(accent: accent)
        #endif
    }

    private func mapKit(accent: Color.Resolved) -> some View {
        MapReader { proxy in
            Map(position: $camera) {
                ForEach(routes.filter { $0.id != selected?.id }) { route in
                    MapPolyline(coordinates: route.locations)
                        .stroke(.black.opacity(0.35), style: Self.line(5.5))
                    MapPolyline(coordinates: route.locations)
                        .stroke(.white.opacity(0.92), style: Self.line(3))
                }
                if let selected, let start = selected.locations.first {
                    ForEach([SelectedKey(id: selected.id, accent: accent)], id: \.self) { _ in
                        MapPolyline(coordinates: selected.locations)
                            .stroke(.white, style: Self.line(9.5))
                        MapPolyline(coordinates: selected.locations)
                            .stroke(Color(accent), style: Self.line(5.5))
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
                    if let calloutDetail, let top = selected.locations.max(by: { $0.latitude < $1.latitude }) {
                        Annotation(selected.name, coordinate: top, anchor: .bottom) {
                            RouteCallout(name: selected.name, detail: calloutDetail)
                        }
                        .annotationTitles(.hidden)
                    }
                }
                UserAnnotation()
            }
            .mapStyle(look.style)
            .onTapGesture { point in
                if let id = nearestRoute(to: point, in: proxy) { select(id) }
            }
        }
    }

    /// The drawn route closest to `point`, if one passes within 22pt of it.
    private func nearestRoute(to point: CGPoint, in proxy: MapProxy) -> UUID? {
        var nearest: (id: UUID, distance: CGFloat)?
        for route in routes + [selected].compactMap({ $0 }) {
            let points = route.locations.compactMap { proxy.convert($0, to: .local) }
            let distance = zip(points, points.dropFirst()).map { Self.distance(from: point, toSegment: $0, $1) }.min() ?? .infinity
            if distance < 22, distance < (nearest?.distance ?? .infinity) { nearest = (route.id, distance) }
        }
        return nearest?.id
    }

    private static func distance(from p: CGPoint, toSegment a: CGPoint, _ b: CGPoint) -> CGFloat {
        let (dx, dy) = (b.x - a.x, b.y - a.y)
        let length = dx * dx + dy * dy
        let t = length == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    private static func line(_ width: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
    }

    private struct SelectedKey: Hashable {
        var id: UUID
        var accent: Color.Resolved
    }
}

/// "Hilly Loop 51 km" in a bubble pointing down at the route's northernmost point.
private struct RouteCallout: View {
    var name: String
    var detail: String

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(name)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
            .lineLimit(1)
            .padding(.vertical, 6)
            .padding(.horizontal, 11)
            .background(.cardBackground, in: .rect(cornerRadius: CornerRadius.badge))
            CalloutPointer()
                .fill(.cardBackground)
                .frame(width: 14, height: 6)
        }
        .compositingGroup()
        .shadow(color: .black.opacity(0.28), radius: 7, y: 4)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
    }
}

private struct CalloutPointer: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
            path.closeSubpath()
        }
    }
}

/// Map style and my location, stacked in glass at the map's top trailing corner: clear with white
/// glyphs over imagery; over the light cycle map regular with `.primary` glyphs, kept light in Dark
/// Mode as the map is (docs/maps/README.md, WS2.7).
struct MapControls: View {
    @Binding var look: MapLook
    var overLightMap = false
    var locate: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            Menu {
                Picker("Map style", selection: $look) {
                    ForEach(MapLook.allCases) { Text($0.title).tag($0) }
                }
            } label: {
                Image(systemName: "square.2.layers.3d")
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .accessibilityLabel("Map style")
            Rectangle()
                .fill(overLightMap ? Color.primary.opacity(0.2) : .white.opacity(0.4))
                .frame(height: 0.5)
                .padding(.horizontal, 9)
                .accessibilityHidden(true)
            Button(action: locate) {
                Image(systemName: "location")
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show my location")
        }
        .frame(width: 44)
        .font(.title3)
        // Chrome over the map, held at a fixed size like MapKit's own controls; long-press
        // shows the large content viewer instead.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityShowsLargeContentViewer()
        .foregroundStyle(overLightMap ? Color.primary : .white)
        .tint(overLightMap ? Color.primary : .white)
        .accessibleGlass(overLightMap ? .regular.interactive() : .clear.interactive(), in: .capsule,
                         fallback: overLightMap ? .white : .black)
        .environment(\.colorScheme, overLightMap ? .light : colorScheme)
    }
}

extension RouteLibrary.Route {
    var locations: [CLLocationCoordinate2D] {
        coordinates.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }
}

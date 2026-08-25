import Foundation
import MapKit
import SwiftUI
import Models

#if os(macOS)
import AppKit
public typealias PlatformImage = NSImage
#else
import UIKit
public typealias PlatformImage = UIImage
#endif

/// The coordinate → snapshot-image-point mapping, captured from the
/// snapshotter when the image is rendered. Web-Mercator is affine in
/// `MKMapPoint` space (no rotation, uniform axes), so four numbers reproduce
/// `MKMapSnapshotter.Snapshot.point(for:)` exactly — including for
/// disk-cached images, where the snapshot object is long gone. Lets callers
/// place overlays (e.g. the elevation-scrub dot) on a cached snapshot.
public struct SnapshotProjection: Codable, Sendable {
    var originX: Double
    var originY: Double
    var scaleX: Double
    var scaleY: Double

    /// Position of `coordinate` in the snapshot image's point space.
    public func point(for coordinate: Coordinate) -> CGPoint {
        let mapPoint = MKMapPoint(CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude))
        return CGPoint(x: (mapPoint.x - originX) * scaleX, y: (mapPoint.y - originY) * scaleY)
    }
}

/// `MKMapSnapshotter`-based route thumbnails for the Routes list, per
/// DESIGN-SYSTEM.md: `.standard` map type, POIs excluded, polyline drawn on.
/// Disk-cached (Caches dir) keyed by route id + size + light/dark, with an
/// in-memory `NSCache` in front. No actor gymnastics: this is a handful of
/// async functions, not a shared mutable service object.
public enum RouteSnapshotService {
    // ponytail: NSCache is internally thread-safe (Apple docs), just not marked Sendable.
    nonisolated(unsafe) private static let memoryCache = NSCache<NSString, PlatformImage>()
    nonisolated(unsafe) private static let projectionCache = NSCache<NSString, ProjectionBox>()

    private final class ProjectionBox {
        let value: SnapshotProjection
        init(_ value: SnapshotProjection) { self.value = value }
    }

    // ponytail: takes plain id/coordinates rather than `RouteModel` — the
    // SwiftData model isn't Sendable, and this service has no business
    // touching the model beyond reading these two values anyway.
    public static func snapshot(routeID: UUID, coordinates: [Coordinate], size: CGSize, colorScheme: ColorScheme) async -> PlatformImage? {
        guard coordinates.count > 1 else { return nil }

        let key = cacheKey(routeID: routeID, size: size, colorScheme: colorScheme)

        if let cached = memoryCache.object(forKey: key as NSString) {
            return cached
        }
        if let diskURL = diskCacheURL(for: key), let data = try? Data(contentsOf: diskURL), let image = PlatformImage(data: data) {
            memoryCache.setObject(image, forKey: key as NSString)
            return image
        }

        return await renderFresh(key: key, coordinates: coordinates, size: size, colorScheme: colorScheme)?.image
    }

    /// The projection for the same snapshot `snapshot(...)` returns. Served
    /// from cache; on a miss (e.g. a PNG cached before projections existed)
    /// it re-renders once, which also refreshes the image caches.
    public static func projection(routeID: UUID, coordinates: [Coordinate], size: CGSize, colorScheme: ColorScheme) async -> SnapshotProjection? {
        guard coordinates.count > 1 else { return nil }

        let key = cacheKey(routeID: routeID, size: size, colorScheme: colorScheme)

        if let cached = projectionCache.object(forKey: key as NSString) {
            return cached.value
        }
        if let diskURL = projectionDiskURL(for: key), let data = try? Data(contentsOf: diskURL),
           let projection = try? JSONDecoder().decode(SnapshotProjection.self, from: data) {
            projectionCache.setObject(ProjectionBox(projection), forKey: key as NSString)
            return projection
        }

        return await renderFresh(key: key, coordinates: coordinates, size: size, colorScheme: colorScheme)?.projection
    }

    private static func renderFresh(key: String, coordinates: [Coordinate], size: CGSize, colorScheme: ColorScheme) async -> (image: PlatformImage, projection: SnapshotProjection)? {
        let options = MKMapSnapshotter.Options()
        options.size = size
        options.mapType = .standard
        options.pointOfInterestFilter = .excludingAll
        options.region = region(fitting: coordinates)
        #if os(iOS)
        options.traitCollection = UITraitCollection(userInterfaceStyle: colorScheme == .dark ? .dark : .light)
        #endif

        guard let snapshot = try? await MKMapSnapshotter(options: options).start() else { return nil }
        let image = draw(polyline: coordinates, on: snapshot)
        let projection = projection(from: snapshot, fitting: coordinates)

        memoryCache.setObject(image, forKey: key as NSString)
        projectionCache.setObject(ProjectionBox(projection), forKey: key as NSString)
        if let diskURL = diskCacheURL(for: key), let data = pngData(image) {
            try? data.write(to: diskURL)
        }
        if let diskURL = projectionDiskURL(for: key), let data = try? JSONEncoder().encode(projection) {
            try? data.write(to: diskURL)
        }
        return (image, projection)
    }

    /// Solve the affine map from two probe points the snapshotter projects
    /// for us — exact by construction, no guessing at MapKit's internal
    /// region-to-aspect fitting.
    private static func projection(from snapshot: MKMapSnapshotter.Snapshot, fitting coordinates: [Coordinate]) -> SnapshotProjection {
        let region = region(fitting: coordinates)
        let a = CLLocationCoordinate2D(
            latitude: region.center.latitude - region.span.latitudeDelta / 4,
            longitude: region.center.longitude - region.span.longitudeDelta / 4
        )
        let b = CLLocationCoordinate2D(
            latitude: region.center.latitude + region.span.latitudeDelta / 4,
            longitude: region.center.longitude + region.span.longitudeDelta / 4
        )
        var pa = snapshot.point(for: a), pb = snapshot.point(for: b)
        #if os(macOS)
        // AppKit's `point(for:)` is bottom-left origin (which is why the
        // polyline draws correctly in the non-flipped `lockFocus` context);
        // SwiftUI overlays are top-left. Flip here so `SnapshotProjection`
        // is top-left origin on both platforms.
        pa.y = snapshot.image.size.height - pa.y
        pb.y = snapshot.image.size.height - pb.y
        #endif
        let ma = MKMapPoint(a), mb = MKMapPoint(b)
        let scaleX = (pb.x - pa.x) / (mb.x - ma.x)
        let scaleY = (pb.y - pa.y) / (mb.y - ma.y)
        return SnapshotProjection(
            originX: ma.x - pa.x / scaleX,
            originY: ma.y - pa.y / scaleY,
            scaleX: scaleX,
            scaleY: scaleY
        )
    }

    public static func region(fitting coordinates: [Coordinate]) -> MKCoordinateRegion {
        let lats = coordinates.map(\.latitude)
        let lons = coordinates.map(\.longitude)
        let minLat = lats.min() ?? 0, maxLat = lats.max() ?? 0
        let minLon = lons.min() ?? 0, maxLon = lons.max() ?? 0
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        // 30% padding around the route's bounding box so the polyline isn't
        // flush against the thumbnail edge; floor on span so a near-point
        // route (e.g. a single-loop start/end) still frames sensibly.
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.3, 0.01),
            longitudeDelta: max((maxLon - minLon) * 1.3, 0.01)
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    public static func cacheKey(routeID: UUID, size: CGSize, colorScheme: ColorScheme) -> String {
        "\(routeID.uuidString)-\(Int(size.width))x\(Int(size.height))-\(colorScheme == .dark ? "dark" : "light")"
    }

    private static func diskCacheURL(for key: String) -> URL? {
        guard let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let dir = cachesDir.appendingPathComponent("RouteSnapshots", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(key).png")
    }

    private static func projectionDiskURL(for key: String) -> URL? {
        // "v2": v1 sidecars were bottom-left origin on macOS — must not be served.
        diskCacheURL(for: key)?.deletingPathExtension().appendingPathExtension("projection-v2.json")
    }

    private static func draw(polyline coordinates: [Coordinate], on snapshot: MKMapSnapshotter.Snapshot) -> PlatformImage {
        let points = coordinates.map { snapshot.point(for: CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)) }
        #if os(macOS)
        let image = NSImage(size: snapshot.image.size)
        image.lockFocus()
        snapshot.image.draw(at: .zero, from: .zero, operation: .copy, fraction: 1)
        if let first = points.first {
            let path = NSBezierPath()
            path.move(to: first)
            points.dropFirst().forEach { path.line(to: $0) }
            path.lineWidth = 3
            NSColor(Color.accentColor).setStroke()
            path.stroke()
        }
        image.unlockFocus()
        return image
        #else
        let renderer = UIGraphicsImageRenderer(size: snapshot.image.size)
        return renderer.image { _ in
            snapshot.image.draw(at: .zero)
            guard let first = points.first else { return }
            let path = UIBezierPath()
            path.move(to: first)
            points.dropFirst().forEach { path.addLine(to: $0) }
            path.lineWidth = 3
            UIColor(Color.accentColor).setStroke()
            path.stroke()
        }
        #endif
    }

    private static func pngData(_ image: PlatformImage) -> Data? {
        #if os(macOS)
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
        #else
        return image.pngData()
        #endif
    }
}

import Foundation
import MapKit
import SwiftUI
import RideOnCore

#if os(macOS)
import AppKit
typealias PlatformImage = NSImage
#else
import UIKit
typealias PlatformImage = UIImage
#endif

/// `MKMapSnapshotter`-based route thumbnails for the Routes list, per
/// DESIGN-SYSTEM.md: `.standard` map type, POIs excluded, polyline drawn on.
/// Disk-cached (Caches dir) keyed by route id + size + light/dark, with an
/// in-memory `NSCache` in front. No actor gymnastics: this is a handful of
/// async functions, not a shared mutable service object.
enum RouteSnapshotService {
    // ponytail: NSCache is internally thread-safe (Apple docs), just not marked Sendable.
    nonisolated(unsafe) private static let memoryCache = NSCache<NSString, PlatformImage>()

    // ponytail: takes plain id/coordinates rather than `RouteModel` — the
    // SwiftData model isn't Sendable, and this service has no business
    // touching the model beyond reading these two values anyway.
    static func snapshot(routeID: UUID, coordinates: [Coordinate], size: CGSize, colorScheme: ColorScheme) async -> PlatformImage? {
        guard coordinates.count > 1 else { return nil }

        let key = cacheKey(routeID: routeID, size: size, colorScheme: colorScheme)

        if let cached = memoryCache.object(forKey: key as NSString) {
            return cached
        }
        if let diskURL = diskCacheURL(for: key), let data = try? Data(contentsOf: diskURL), let image = PlatformImage(data: data) {
            memoryCache.setObject(image, forKey: key as NSString)
            return image
        }

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

        memoryCache.setObject(image, forKey: key as NSString)
        if let diskURL = diskCacheURL(for: key), let data = pngData(image) {
            try? data.write(to: diskURL)
        }
        return image
    }

    static func region(fitting coordinates: [Coordinate]) -> MKCoordinateRegion {
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

    static func cacheKey(routeID: UUID, size: CGSize, colorScheme: ColorScheme) -> String {
        "\(routeID.uuidString)-\(Int(size.width))x\(Int(size.height))-\(colorScheme == .dark ? "dark" : "light")"
    }

    private static func diskCacheURL(for key: String) -> URL? {
        guard let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let dir = cachesDir.appendingPathComponent("RouteSnapshots", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(key).png")
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

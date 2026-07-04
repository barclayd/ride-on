import XCTest
import SwiftUI
import Models
@testable import Services

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Verifies the disk-cache read path in `RouteSnapshotService.snapshot` is
/// actually hit — seeds the cache file directly (same path formula the
/// service uses internally) rather than going through `MKMapSnapshotter`,
/// which needs live network/map tiles (never allowed in tests, PLAN.md
/// Testing strategy).
final class RouteSnapshotServiceCacheTests: XCTestCase {
    func testSnapshotReturnsDiskCachedImageWithoutRendering() async throws {
        let routeID = UUID()
        let size = CGSize(width: 64, height: 64)
        let colorScheme: ColorScheme = .light
        let key = RouteSnapshotService.cacheKey(routeID: routeID, size: size, colorScheme: colorScheme)

        let cachesDir = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first)
        let dir = cachesDir.appendingPathComponent("RouteSnapshots", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent("\(key).png")
        try Self.pngData(size: size).write(to: fileURL)
        addTeardownBlock { try? FileManager.default.removeItem(at: fileURL) }

        // Deliberately impossible bounding box (0,0)-(0.001,0.001) — if this
        // fell through to `MKMapSnapshotter`, offline/sandboxed test runs
        // would hang or fail; a real cache hit never reaches it.
        let coordinates = [Coordinate(latitude: 0, longitude: 0), Coordinate(latitude: 0.001, longitude: 0.001)]

        let result = await RouteSnapshotService.snapshot(routeID: routeID, coordinates: coordinates, size: size, colorScheme: colorScheme)

        XCTAssertNotNil(result, "expected the seeded disk cache entry to be returned")
    }

    private static func pngData(size: CGSize) throws -> Data {
        #if os(macOS)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.red.setFill()
        NSBezierPath(rect: CGRect(origin: .zero, size: size)).fill()
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let data = rep.representation(using: .png, properties: [:]) else {
            throw XCTSkip("could not encode PNG on this platform")
        }
        return data
        #else
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            UIColor.red.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
        guard let data = image.pngData() else {
            throw XCTSkip("could not encode PNG on this platform")
        }
        return data
        #endif
    }
}

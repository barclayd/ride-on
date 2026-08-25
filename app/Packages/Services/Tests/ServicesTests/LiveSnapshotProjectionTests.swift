import XCTest
import SwiftUI
import Models
@testable import Services

/// End-to-end check of `SnapshotProjection` against a REAL `MKMapSnapshotter`
/// render (needs network for map tiles, so skipped unless
/// RUN_LIVE_SNAPSHOT_TEST=1 — same pattern as LiveClassifyIntegrationTests).
///
/// Exists because the projection has failed twice in ways an offline test
/// can't see: image point-space vs pixel-space confusion, and macOS's
/// bottom-left-origin `point(for:)`. These assertions pin the contract the
/// scrub map dot relies on: top-left origin, in-bounds, and affine-consistent
/// on BOTH platforms.
final class LiveSnapshotProjectionTests: XCTestCase {
    func testProjectionIsTopLeftOriginInBoundsAndAffine() async throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RUN_LIVE_SNAPSHOT_TEST"] == "1",
            "Set RUN_LIVE_SNAPSHOT_TEST=1 to run the live MKMapSnapshotter check."
        )

        // A SW→NE diagonal: distinct latitudes and longitudes at every point.
        let south = Coordinate(latitude: 51.70, longitude: -0.85)
        let mid = Coordinate(latitude: 51.75, longitude: -0.80)
        let north = Coordinate(latitude: 51.80, longitude: -0.75)
        let coordinates = [south, mid, north]
        let size = CGSize(width: 400, height: 300)

        let projection = await RouteSnapshotService.projection(
            routeID: UUID(), // fresh id → no cache, forces a live render
            coordinates: coordinates,
            size: size,
            colorScheme: .light
        )
        let projection2 = try XCTUnwrap(projection, "live snapshotter render failed (offline?)")

        let pSouth = projection2.point(for: south)
        let pMid = projection2.point(for: mid)
        let pNorth = projection2.point(for: north)

        // Top-left origin: north must be ABOVE south (smaller y), east right of west.
        XCTAssertLessThan(pNorth.y, pSouth.y, "y grows downward — macOS point(for:) flip missing?")
        XCTAssertGreaterThan(pNorth.x, pSouth.x)

        // Every route coordinate lands inside the snapshot (region has 30% padding).
        for p in [pSouth, pMid, pNorth] {
            XCTAssertTrue((0...size.width).contains(p.x), "\(p) outside width — wrong point space?")
            XCTAssertTrue((0...size.height).contains(p.y), "\(p) outside height — wrong point space?")
        }

        // Affine sanity: the geographic midpoint projects to (nearly) the pixel
        // midpoint — Mercator nonlinearity over 0.1° of latitude is sub-pixel.
        XCTAssertEqual(pMid.x, (pSouth.x + pNorth.x) / 2, accuracy: 1.0)
        XCTAssertEqual(pMid.y, (pSouth.y + pNorth.y) / 2, accuracy: 1.0)
    }

    #if os(macOS)
    /// The whole contract at once: every projected route coordinate must land
    /// ON the polyline the service drew into the image — through the real
    /// render, disk write, and reload. Catches y-flips, point/pixel-space
    /// mixups, and any future drift between `draw()` and `SnapshotProjection`.
    func testProjectedCoordinatesLandOnDrawnPolyline() async throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RUN_LIVE_SNAPSHOT_TEST"] == "1",
            "Set RUN_LIVE_SNAPSHOT_TEST=1 to run the live MKMapSnapshotter check."
        )

        // An L-shaped track so x and y errors can't cancel out.
        let coordinates = [
            Coordinate(latitude: 51.70, longitude: -0.85),
            Coordinate(latitude: 51.78, longitude: -0.85),
            Coordinate(latitude: 51.78, longitude: -0.72),
        ]
        let size = CGSize(width: 400, height: 300)
        let routeID = UUID()

        let rendered = await RouteSnapshotService.snapshot(routeID: routeID, coordinates: coordinates, size: size, colorScheme: .light)
        _ = try XCTUnwrap(rendered, "live snapshotter render failed (offline?)")
        let maybeProjection = await RouteSnapshotService.projection(routeID: routeID, coordinates: coordinates, size: size, colorScheme: .light)
        let projection = try XCTUnwrap(maybeProjection)

        // Reload from the disk cache like a relaunched app would — the path
        // where NSImage reports pixel (not point) dimensions.
        let key = RouteSnapshotService.cacheKey(routeID: routeID, size: size, colorScheme: .light)
        let cachesDir = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first)
        let pngURL = cachesDir.appendingPathComponent("RouteSnapshots/\(key).png")
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: try Data(contentsOf: pngURL)))
        // Bitmap pixels vs the 400x300 point space the projection targets.
        let pixelsPerPoint = Double(bitmap.pixelsWide) / size.width

        for (index, coordinate) in coordinates.enumerated() {
            let p = projection.point(for: coordinate)
            let px = Int((p.x * pixelsPerPoint).rounded())
            let py = Int((p.y * pixelsPerPoint).rounded())
            XCTAssertTrue(
                hasPolylinePixel(in: bitmap, nearX: px, y: py, radius: 3),
                "coordinate \(index) projected to (\(px), \(py)) but no polyline pixel is within 3px"
            )
        }
    }

    /// The polyline is the only high-saturation stroke on a muted `.standard`
    /// map — look for any strongly saturated pixel in a small window.
    private func hasPolylinePixel(in bitmap: NSBitmapImageRep, nearX x: Int, y: Int, radius: Int) -> Bool {
        for dy in -radius...radius {
            for dx in -radius...radius {
                let sx = x + dx, sy = y + dy
                guard sx >= 0, sy >= 0, sx < bitmap.pixelsWide, sy < bitmap.pixelsHigh,
                      let color = bitmap.colorAt(x: sx, y: sy)?.usingColorSpace(.deviceRGB) else { continue }
                var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
                color.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
                if saturation > 0.5, brightness > 0.5 { return true }
            }
        }
        return false
    }
    #endif
}

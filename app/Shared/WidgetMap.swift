import Foundation
import MapKit
import Models

/// The map stills the app renders into the App Group, and how the widget lays the loop over one
/// (docs/redesign/README.md §8). A still is named after its framing, so a route that moves gets a new
/// one and the app prunes the rest.
enum WidgetMap {
    enum Shape: String, CaseIterable {
        /// systemSmall's and systemLarge's top band.
        case band
        /// systemMedium's right side.
        case tall
        /// systemExtraLarge's left half.
        case square

        /// Points, at the largest widget that shows it.
        var size: CGSize {
            switch self {
            case .band: CGSize(width: 364, height: 170)
            case .tall: CGSize(width: 150, height: 170)
            case .square: CGSize(width: 372, height: 356)
            }
        }
    }

    /// The loop's bounds, padded by `pad` and widened to `aspect` (width over height).
    static func framing(_ loop: [Coordinate], aspect: CGFloat, pad: Double = 1.5) -> MKMapRect {
        let points = loop.map(MKMapPoint.init)
        guard let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
              let minY = points.map(\.y).min(), let maxY = points.map(\.y).max() else { return .null }
        var width = max(maxX - minX, 1) * pad, height = max(maxY - minY, 1) * pad
        if width / height < aspect { width = height * aspect } else { height = width / aspect }
        return MKMapRect(x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width: width, height: height)
    }

    static func framing(_ loop: [Coordinate], _ shape: Shape) -> MKMapRect {
        framing(loop, aspect: shape.size.width / shape.size.height)
    }

    static func url(_ rect: MKMapRect, _ shape: Shape) -> URL? {
        WidgetStore.directory?.appending(path: "map-\(Int(rect.minX))-\(Int(rect.minY))-\(Int(rect.width))-\(shape.rawValue).jpg")
    }

    /// `loop` in a `size` view that shows `rect` filled and centred, as `.scaledToFill()` draws its still.
    static func project(_ loop: [Coordinate], in rect: MKMapRect, size: CGSize) -> [CGPoint] {
        let scale = max(size.width / rect.width, size.height / rect.height)
        return loop.map {
            let p = MKMapPoint($0)
            return CGPoint(x: (p.x - rect.midX) * scale + size.width / 2, y: (p.y - rect.midY) * scale + size.height / 2)
        }
    }
}

extension MKMapPoint {
    init(_ coordinate: Coordinate) {
        self.init(CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude))
    }
}

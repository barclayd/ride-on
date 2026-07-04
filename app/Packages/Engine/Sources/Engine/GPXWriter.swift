import Foundation
import Models

/// The write-side counterpart to `GPXParser` — a minimal GPX 1.1 track
/// serializer. Shared by the Strava route-export fixture/live paths and
/// `RoutesUI`'s "Export GPX" action, instead of each hand-rolling XML.
public enum GPXWriter {
    public static func data(name: String, coordinates: [Coordinate], elevations: [Double?] = []) -> Data {
        var xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"RideOn\"><trk><name>\(name)</name><trkseg>\n"
        for (index, coordinate) in coordinates.enumerated() {
            xml += "<trkpt lat=\"\(coordinate.latitude)\" lon=\"\(coordinate.longitude)\">"
            if index < elevations.count, let elevation = elevations[index] {
                xml += "<ele>\(elevation)</ele>"
            }
            xml += "</trkpt>\n"
        }
        xml += "</trkseg></trk></gpx>"
        return Data(xml.utf8)
    }
}

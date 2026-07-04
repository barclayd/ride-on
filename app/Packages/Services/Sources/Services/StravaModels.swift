import Foundation
import Models

public struct StravaToken: Codable, Sendable, Hashable {
    public var accessToken: String
    public var refreshToken: String
    public var expiresAt: Date
    public var athleteID: Int?

    public init(accessToken: String, refreshToken: String, expiresAt: Date, athleteID: Int? = nil) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.athleteID = athleteID
    }
}

/// Google's encoded polyline algorithm (precision 5) — what Strava's
/// `map.summary_polyline` uses. No dependency; short enough to hand-roll.
public enum PolylineDecoder {
    public static func decode(_ encoded: String) -> [Coordinate] {
        var coordinates: [Coordinate] = []
        var index = encoded.startIndex
        var lat = 0
        var lon = 0

        while index < encoded.endIndex {
            guard let dLat = decodeValue(encoded, &index), let dLon = decodeValue(encoded, &index) else { break }
            lat += dLat
            lon += dLon
            coordinates.append(Coordinate(latitude: Double(lat) / 1e5, longitude: Double(lon) / 1e5))
        }
        return coordinates
    }

    private static func decodeValue(_ encoded: String, _ index: inout String.Index) -> Int? {
        var result = 0
        var shift = 0
        var byte: Int
        repeat {
            guard index < encoded.endIndex, let ascii = encoded[index].asciiValue else { return nil }
            byte = Int(ascii) - 63
            encoded.formIndex(after: &index)
            result |= (byte & 0x1F) << shift
            shift += 5
        } while byte >= 0x20
        return (result & 1) != 0 ? ~(result >> 1) : (result >> 1)
    }
}

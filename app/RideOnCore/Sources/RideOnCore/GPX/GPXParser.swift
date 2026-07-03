import Foundation

public struct GPXTrackPoint: Codable, Sendable, Hashable {
    public var coordinate: Coordinate
    public var elevationM: Double?
    public var time: Date?

    public init(coordinate: Coordinate, elevationM: Double? = nil, time: Date? = nil) {
        self.coordinate = coordinate
        self.elevationM = elevationM
        self.time = time
    }
}

/// One ~1km slice of a track with the compass bearing of travel across it —
/// the raw material for the wind-alignment scoring factor (Phase 3).
public struct BearingSegment: Codable, Sendable, Hashable {
    public var bearingDegrees: Double
    public var lengthKm: Double

    public init(bearingDegrees: Double, lengthKm: Double) {
        self.bearingDegrees = bearingDegrees
        self.lengthKm = lengthKm
    }
}

public struct GPXTrack: Codable, Sendable, Hashable {
    public var name: String?
    public var points: [GPXTrackPoint]

    public init(name: String? = nil, points: [GPXTrackPoint]) {
        self.name = name
        self.points = points
    }

    public var coordinates: [Coordinate] { points.map(\.coordinate) }

    /// Total distance, summing haversine great-circle distance between
    /// consecutive points.
    public var distanceKm: Double {
        guard points.count > 1 else { return 0 }
        return zip(points, points.dropFirst()).reduce(0) { total, pair in
            total + GPXGeometry.haversineKm(pair.0.coordinate, pair.1.coordinate)
        }
    }

    /// Smoothed elevation gain via `ElevationSmoother`. Points missing `ele`
    /// are dropped rather than interpolated — fine for the moving-average +
    /// min-delta approach, and simplest for tracks that are missing it
    /// entirely (gain comes back 0).
    public var elevationGainM: Double {
        let elevations = points.compactMap(\.elevationM)
        guard elevations.count > 1 else { return 0 }
        return ElevationSmoother.smoothedGain(rawElevations: elevations)
    }

    /// Segments the track every `segmentLengthKm` (default ~1km) and returns
    /// the bearing across each segment, for the future wind-alignment factor.
    public func bearingSegments(segmentLengthKm: Double = 1.0) -> [BearingSegment] {
        GPXGeometry.bearingSegments(coordinates: coordinates, segmentLengthKm: segmentLengthKm)
    }
}

public enum GPXParserError: Error, Sendable, Equatable {
    case malformedDocument(String)
    case noTrackPoints
}

/// GPX 1.1 ingestion via `Foundation.XMLParser` — no third-party dependency.
/// Handles `trk/trkseg/trkpt` (cycle.travel, Strava, most exports) and
/// `rte/rtept`-only route files (no `rteseg` in the GPX schema). Unknown
/// elements (Strava's `<extensions>` track-point extensions, metadata, etc.)
/// are silently ignored. Missing `<ele>` is tolerated (nil elevation, gain
/// calc drops those points). Malformed/truncated XML and points missing
/// `lat`/`lon` both throw `.malformedDocument`.
public enum GPXParser {
    public static func parse(data: Data) throws -> GPXTrack {
        let delegate = GPXXMLDelegate()
        let xmlParser = XMLParser(data: data)
        xmlParser.delegate = delegate

        let success = xmlParser.parse()

        if let error = delegate.error {
            throw error
        }
        guard success else {
            let message = xmlParser.parserError?.localizedDescription ?? "unknown XML parse error"
            throw GPXParserError.malformedDocument(message)
        }
        guard !delegate.points.isEmpty else {
            throw GPXParserError.noTrackPoints
        }
        return GPXTrack(name: delegate.name, points: delegate.points)
    }
}

/// Haversine distance + bearing, and the bearing-segmenting used by
/// `GPXTrack`. Kept internal — nothing outside GPX ingestion needs it yet;
/// promote to `public` if route-overlap geometry (Phase 3 novelty factor)
/// wants to share it.
enum GPXGeometry {
    static let earthRadiusKm = 6371.0088

    static func haversineKm(_ a: Coordinate, _ b: Coordinate) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return earthRadiusKm * 2 * atan2(sqrt(h), sqrt(1 - h))
    }

    static func bearingDegrees(from a: Coordinate, to b: Coordinate) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let bearing = atan2(y, x) * 180 / .pi
        return (bearing + 360).truncatingRemainder(dividingBy: 360)
    }

    static func bearingSegments(coordinates: [Coordinate], segmentLengthKm: Double) -> [BearingSegment] {
        guard coordinates.count > 1, segmentLengthKm > 0 else { return [] }

        var segments: [BearingSegment] = []
        var segmentStart = coordinates[0]
        var accumulated = 0.0

        for i in 1..<coordinates.count {
            accumulated += haversineKm(coordinates[i - 1], coordinates[i])
            let isLastPoint = i == coordinates.count - 1
            if accumulated >= segmentLengthKm || isLastPoint {
                let bearing = bearingDegrees(from: segmentStart, to: coordinates[i])
                segments.append(BearingSegment(bearingDegrees: bearing, lengthKm: accumulated))
                segmentStart = coordinates[i]
                accumulated = 0
            }
        }
        return segments
    }
}

/// `XMLParser` delegate that pulls out everything `GPXParser` needs and
/// nothing else. One `<name>` is captured (the first one seen — trk/rte
/// name or GPX metadata name, whichever comes first) since a track only
/// needs the one title.
private final class GPXXMLDelegate: NSObject, XMLParserDelegate {
    var name: String?
    var points: [GPXTrackPoint] = []
    var error: GPXParserError?

    private var characterBuffer = ""
    private var isCapturingPoint = false
    private var isCapturingEle = false
    private var isCapturingTime = false
    private var isCapturingName = false
    private var pendingLat: Double?
    private var pendingLon: Double?
    private var pendingEle: Double?
    private var pendingTime: Date?

    private let dateFormatterWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private let dateFormatter = ISO8601DateFormatter()

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        characterBuffer = ""
        switch elementName {
        case "trkpt", "rtept":
            guard
                let latString = attributeDict["lat"], let lat = Double(latString),
                let lonString = attributeDict["lon"], let lon = Double(lonString)
            else {
                error = .malformedDocument("\(elementName) is missing a valid lat/lon attribute")
                parser.abortParsing()
                return
            }
            isCapturingPoint = true
            pendingLat = lat
            pendingLon = lon
            pendingEle = nil
            pendingTime = nil
        case "ele":
            isCapturingEle = isCapturingPoint
        case "time":
            isCapturingTime = isCapturingPoint
        case "name":
            isCapturingName = name == nil
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        characterBuffer += string
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        let trimmed = characterBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
        switch elementName {
        case "ele":
            if isCapturingEle {
                pendingEle = Double(trimmed)
                isCapturingEle = false
            }
        case "time":
            if isCapturingTime {
                pendingTime = dateFormatterWithFraction.date(from: trimmed) ?? dateFormatter.date(from: trimmed)
                isCapturingTime = false
            }
        case "name":
            if isCapturingName {
                name = trimmed.isEmpty ? nil : trimmed
                isCapturingName = false
            }
        case "trkpt", "rtept":
            if isCapturingPoint, let lat = pendingLat, let lon = pendingLon {
                points.append(
                    GPXTrackPoint(coordinate: Coordinate(latitude: lat, longitude: lon), elevationM: pendingEle, time: pendingTime)
                )
            }
            isCapturingPoint = false
        default:
            break
        }
        characterBuffer = ""
    }
}

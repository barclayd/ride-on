import Foundation
import Testing
import Models
@testable import Engine

private func fixtureData(_ name: String) throws -> Data {
    guard let url = Bundle.module.url(forResource: name, withExtension: "gpx", subdirectory: "Fixtures") else {
        Issue.record("missing fixture \(name).gpx")
        throw GPXParserError.noTrackPoints
    }
    return try Data(contentsOf: url)
}

@Suite("GPXParser")
struct GPXParserTests {
    @Test("cycle.travel-style trk with ele + time parses name, points, distance, gain")
    func cycleTravelStyleTrack() throws {
        let track = try GPXParser.parse(data: try fixtureData("sample-route"))
        #expect(track.name == "Chilterns Test Loop")
        #expect(track.points.count == 20)
        #expect(track.points.allSatisfy { $0.elevationM != nil })
        #expect(track.points.allSatisfy { $0.time != nil })
        #expect(track.distanceKm > 0)
        #expect(track.elevationGainM > 0)
    }

    @Test("Strava-style track with gpxtpx extensions ignores unknown elements")
    func stravaStyleWithExtensions() throws {
        let track = try GPXParser.parse(data: try fixtureData("strava-style"))
        #expect(track.name == "Morning Ride")
        #expect(track.points.count == 4)
        #expect(track.points.first?.elevationM == 120.0)
        #expect(track.points.last?.elevationM == 133.0)
        #expect(track.elevationGainM > 0)
    }

    @Test("route file using rtept instead of trkpt parses correctly")
    func rteptOnlyRoute() throws {
        let track = try GPXParser.parse(data: try fixtureData("route-rtept"))
        #expect(track.name == "Cotswolds Route")
        #expect(track.points.count == 5)
        #expect(track.distanceKm > 0)
    }

    @Test("track missing ele on every point tolerates it, gain is zero")
    func missingElevationEverywhere() throws {
        let track = try GPXParser.parse(data: try fixtureData("missing-elevation"))
        #expect(track.points.count == 4)
        #expect(track.points.allSatisfy { $0.elevationM == nil })
        #expect(track.elevationGainM == 0)
        #expect(track.distanceKm > 0)
    }

    @Test("truncated document throws malformedDocument")
    func truncatedDocumentThrows() throws {
        #expect(throws: GPXParserError.self) {
            _ = try GPXParser.parse(data: try fixtureData("malformed-truncated"))
        }
    }

    @Test("point missing lat/lon throws malformedDocument")
    func missingLatLonThrows() throws {
        #expect(throws: GPXParserError.self) {
            _ = try GPXParser.parse(data: try fixtureData("missing-lat-lon"))
        }
    }

    @Test("empty gpx with no points throws noTrackPoints")
    func noPointsThrows() throws {
        let empty = Data(
            """
            <?xml version="1.0"?>
            <gpx version="1.1"><trk><name>Empty</name><trkseg></trkseg></trk></gpx>
            """.utf8
        )
        #expect(throws: GPXParserError.noTrackPoints) {
            _ = try GPXParser.parse(data: empty)
        }
    }

    @Test("known straight-line fixture produces stable ~1km bearing segments")
    func bearingSegmentsOnStraightLine() throws {
        let track = try GPXParser.parse(data: try fixtureData("straight-line-1km-segments"))
        let segments = track.bearingSegments(segmentLengthKm: 1.0)

        #expect(!segments.isEmpty)
        // Due-east straight line: every segment's bearing should land close
        // to 90 degrees, and each segment should be roughly 1km.
        for segment in segments {
            #expect(abs(segment.bearingDegrees - 90) < 1.0)
            #expect(segment.lengthKm > 0.5 && segment.lengthKm < 1.5)
        }
    }

    @Test("elevation gain is the raw positive-delta sum (Garmin-consistent)")
    func elevationGainIntegration() throws {
        // Out-and-back over one hill: climbs to a peak (0 -> 50) then
        // symmetric descent back to start. Raw positive-delta sum = 50 —
        // the same figure Garmin reports for a course with these <ele>
        // values, with no smoothing applied (embedded elevations come from
        // terrain models, not noisy GPS).
        let points = [0.0, 10.0, 25.0, 50.0, 25.0, 10.0, 0.0].enumerated().map { index, ele in
            GPXTrackPoint(coordinate: Coordinate(latitude: 51.75 + Double(index) * 0.001, longitude: -0.8), elevationM: ele)
        }
        let track = GPXTrack(name: "Hill", points: points)
        #expect(track.elevationGainM == 50)
    }
}

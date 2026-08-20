import Foundation
import Testing
import Models
@testable import Engine

/// Builds a tiny little-endian FIT course in memory: a `course` (31) name
/// message plus `record` (20) messages with position/altitude/timestamp —
/// the same shape Garmin Connect course exports have.
private func makeFITCourse(points: [(lat: Double, lon: Double, eleM: Double)]) -> Data {
    var records: [UInt8] = []

    // Definition, local type 0 -> course (31): one field, name (5), 16 bytes.
    records += [0x40, 0, 0, 31, 0, 1, 5, 16, 0x07]
    var nameBytes = [UInt8]("Test Loop".utf8)
    nameBytes += Array(repeating: 0, count: 16 - nameBytes.count)
    records += [0x00] + nameBytes

    // Definition, local type 1 -> record (20): lat (0, sint32), lon (1,
    // sint32), altitude (2, uint16, scale 5 offset 500), timestamp (253, uint32).
    records += [0x41, 0, 0, 20, 0, 4, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84, 253, 4, 0x86]
    for (index, point) in points.enumerated() {
        records.append(0x01)
        for degrees in [point.lat, point.lon] {
            let semicircles = Int32((degrees * 2147483648.0 / 180.0).rounded())
            records += withUnsafeBytes(of: semicircles.littleEndian, Array.init)
        }
        let altitude = UInt16(((point.eleM + 500) * 5).rounded())
        records += withUnsafeBytes(of: altitude.littleEndian, Array.init)
        records += withUnsafeBytes(of: UInt32(1_000_000 + index).littleEndian, Array.init)
    }

    var file: [UInt8] = [12, 0x10, 0, 0]
    file += withUnsafeBytes(of: UInt32(records.count).littleEndian, Array.init)
    file += [UInt8](".FIT".utf8)
    file += records
    file += [0, 0] // trailing CRC, unverified by the parser
    return Data(file)
}

@Test func parsesFITCoursePointsNameAndElevation() throws {
    let data = makeFITCourse(points: [
        (lat: 51.5074, lon: -0.1278, eleM: 11),
        (lat: 51.5080, lon: -0.1290, eleM: 14.2),
    ])
    #expect(FITParser.isFIT(data: data))

    let track = try FITParser.parse(data: data)
    #expect(track.name == "Test Loop")
    #expect(track.points.count == 2)
    #expect(abs(track.points[0].coordinate.latitude - 51.5074) < 0.000001)
    #expect(abs(track.points[0].coordinate.longitude - -0.1278) < 0.000001)
    #expect(abs((track.points[1].elevationM ?? 0) - 14.2) < 0.1)
    #expect(track.points[0].time != nil)
}

@Test func rejectsNonFITData() {
    let garbage = Data("<gpx></gpx>".utf8)
    #expect(!FITParser.isFIT(data: garbage))
    #expect(throws: FITParserError.self) { try FITParser.parse(data: garbage) }
}

@Test func recordsWithInvalidPositionSentinelAreDropped() throws {
    var data = makeFITCourse(points: [(lat: 51.5, lon: -0.12, eleM: 10)])
    // Overwrite the single record's lat with the sint32 invalid sentinel
    // (0x7FFFFFFF LE); the point should be dropped, leaving no track points.
    let latOffset = 12 + 9 + 17 + 18 + 1
    data.replaceSubrange(latOffset..<latOffset + 4, with: [0xFF, 0xFF, 0xFF, 0x7F])
    #expect(throws: FITParserError.noTrackPoints) { try FITParser.parse(data: data) }
}

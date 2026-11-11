import Foundation
import Testing
import Engine
@testable import RouteFiles

private let gpx = Data("""
<gpx version="1.1" creator="cycle.travel"><trk><name>Forest &amp; lanes</name><trkseg>
<trkpt lat="51.5" lon="-0.1"><ele>15</ele></trkpt>
<trkpt lat="51.51" lon="-0.11"><ele>20</ele></trkpt>
</trkseg></trk></gpx>
""".utf8)

@Test func normalizesGPXAndEscapesNamesWithoutGuessingTheSendingApp() throws {
    let file = try RouteFile(data: gpx, filename: "export.GPX")
    let payload = try file.payload()
    #expect(file.name == "Forest & lanes")
    #expect(payload.source.providerId == "direct-import")
    #expect(payload.source.externalId.count == 64)
    let roundTrip = try GPXParser.parse(data: Data(payload.gpx.utf8))
    #expect(roundTrip.name == file.name)
    #expect(roundTrip.points.map(\.elevationM) == [15, 20])
    #expect(roundTrip.coordinates == file.track.coordinates)
    #expect(try RouteFile(data: gpx, filename: "another.gpx").payload().source.externalId == payload.source.externalId)
}

@Test func validatesFileSizeGeometryAndNames() throws {
    #expect(throws: RouteFile.Failure.self) { try RouteFile(data: gpx, filename: "photo.jpg") }
    #expect(throws: RouteFile.Failure.self) { try RouteFile(data: Data(repeating: 0, count: RouteFile.maximumBytes + 1), filename: "large.fit") }
    for xml in ["garbage", "<gpx/>", "<gpx><rte><rtept lat='91' lon='0'/><rtept lat='51' lon='0'/></rte></gpx>", "<gpx><rte><rtept lat='51' lon='0'/></rte></gpx>"] {
        #expect(throws: RouteFile.Failure.self) { try RouteFile(data: Data(xml.utf8), filename: "route.gpx") }
    }
    var file = try RouteFile(data: gpx, filename: "route.gpx")
    file.name = "  "
    #expect(throws: RouteFile.Failure.self) { try file.payload() }
    file.name = "<Forest> & \"lanes\""
    #expect(try GPXParser.parse(data: Data(file.payload().gpx.utf8)).name == file.name)
}

@Test func usesFilenameForUnnamedRoutesAndBoundsFileReads() throws {
    let file = try RouteFile(data: Data("<gpx><rte><rtept lat='51' lon='0'/><rtept lat='51.1' lon='0'/></rte></gpx>".utf8), filename: "Sunday Loop.gpx")
    #expect(file.name == "Sunday Loop")
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".gpx")
    try gpx.write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }
    #expect(try RouteFile.read(url).name == "Forest & lanes")
}

@Test func convertsFITToTheSameGPXAPIWithElevation() throws {
    var records: [UInt8] = [0x40, 0, 0, 20, 0, 3, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84]
    for (lat, lon, ele) in [(51.5, -0.1, 15.0), (51.51, -0.11, 20.0)] {
        records.append(0)
        for coordinate in [lat, lon] {
            records += withUnsafeBytes(of: Int32((coordinate * 2147483648 / 180).rounded()).littleEndian, Array.init)
        }
        records += withUnsafeBytes(of: UInt16((ele + 500) * 5).littleEndian, Array.init)
    }
    var bytes: [UInt8] = [12, 0x10, 0, 0]
    bytes += withUnsafeBytes(of: UInt32(records.count).littleEndian, Array.init)
    bytes += Array(".FIT".utf8) + records + [0, 0]
    let file = try RouteFile(data: Data(bytes), filename: "Sunday.FIT")
    #expect(file.name == "Sunday")
    let track = try GPXParser.parse(data: Data(file.payload().gpx.utf8))
    #expect(track.points.count == 2)
    #expect(track.points.map(\.elevationM) == [15, 20])
}


@Test func rejectsNonGPXXMLAndDeclaredEntities() {
    let geometry = "<trkpt lat='51' lon='0'/><trkpt lat='51.1' lon='0'/>"
    for xml in ["<document>\(geometry)</document>", "<!DOCTYPE gpx [<!ENTITY route 'test'>]><gpx><name>&route;</name>\(geometry)</gpx>"] {
        #expect(throws: RouteFile.Failure.self) { try RouteFile(data: Data(xml.utf8), filename: "route.gpx") }
    }
}

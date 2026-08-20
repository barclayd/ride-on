import Foundation
import Models

public enum FITParserError: Error, Sendable, Equatable {
    case malformedFile(String)
    case noTrackPoints
}

/// Minimal Garmin FIT ingestion — no third-party dependency, same policy as
/// `GPXParser`. Reads just what a route needs from course/activity files:
/// `record` (20) position/altitude/timestamp and the `course` (31) name.
/// Every other message (file_id, laps, events, course points, developer
/// fields) is measured and skipped. Returns the same `GPXTrack` the GPX path
/// produces so everything downstream (distance, gain, bearings, import
/// pipeline) is shared.
///
/// ponytail: trailing CRCs aren't verified — a corrupt file surfaces as
/// truncation or no points; add CRC-16 if silently-corrupt files ever show up.
public enum FITParser {
    /// FIT files carry ".FIT" at bytes 8-11 of the 12/14-byte header.
    public static func isFIT(data: Data) -> Bool {
        // prefix + Array rather than subscripting: Data slices keep their
        // parent's indices, so absolute offsets 8..<12 would misread a slice.
        let header = [UInt8](data.prefix(12))
        return header.count == 12 && header[8...11].elementsEqual(".FIT".utf8)
    }

    public static func parse(data: Data) throws -> GPXTrack {
        let bytes = [UInt8](data)
        guard bytes.count >= 12, isFIT(data: data) else {
            throw FITParserError.malformedFile("missing .FIT header")
        }
        let headerSize = Int(bytes[0])
        guard headerSize == 12 || headerSize == 14, bytes.count >= headerSize else {
            throw FITParserError.malformedFile("unsupported header size \(bytes[0])")
        }
        let dataSize = bytes[4...7].reversed().reduce(0) { $0 << 8 | Int($1) }
        var reader = ByteReader(
            bytes: bytes,
            offset: headerSize,
            limit: min(headerSize + dataSize, bytes.count)
        )

        var definitions: [UInt8: MessageDefinition] = [:]
        var points: [GPXTrackPoint] = []
        var name: String?

        while !reader.isAtEnd {
            let header = try reader.byte()
            let isCompressedTimestamp = header & 0x80 != 0
            if !isCompressedTimestamp && header & 0x40 != 0 {
                definitions[header & 0x0F] = try MessageDefinition(
                    reader: &reader,
                    hasDeveloperFields: header & 0x20 != 0
                )
                continue
            }
            // Compressed-timestamp headers carry the local type in bits 5-6;
            // the 5-bit time offset is ignored (per-point time is optional).
            let localType = isCompressedTimestamp ? (header >> 5) & 0x03 : header & 0x0F
            guard let definition = definitions[localType] else {
                throw FITParserError.malformedFile("data message before its definition (local type \(localType))")
            }
            try readDataMessage(definition, reader: &reader, points: &points, name: &name)
        }

        guard !points.isEmpty else { throw FITParserError.noTrackPoints }
        return GPXTrack(name: name, creator: nil, points: points)
    }

    // MARK: - Message decoding

    private static let recordMessage: UInt16 = 20
    private static let courseMessage: UInt16 = 31
    /// FIT timestamps count seconds from 1989-12-31T00:00:00Z.
    private static let fitEpoch = Date(timeIntervalSince1970: 631_065_600)
    private static let semicircleToDegrees = 180.0 / 2147483648.0

    private static func readDataMessage(
        _ definition: MessageDefinition,
        reader: inout ByteReader,
        points: inout [GPXTrackPoint],
        name: inout String?
    ) throws {
        var latitude: Double?
        var longitude: Double?
        var elevation: Double?
        var time: Date?

        for field in definition.fields {
            let value = try reader.slice(field.size)
            switch definition.global {
            case Self.recordMessage:
                switch field.number {
                case 0: latitude = semicircles(value, definition.littleEndian)
                case 1: longitude = semicircles(value, definition.littleEndian)
                case 2, 78: // altitude (uint16) / enhanced_altitude (uint32), scale 5 offset 500
                    if let raw = validUInt(value, definition.littleEndian) {
                        elevation = Double(raw) / 5 - 500
                    }
                case 253:
                    if let raw = validUInt(value, definition.littleEndian) {
                        time = Self.fitEpoch.addingTimeInterval(TimeInterval(raw))
                    }
                default: break
                }
            case Self.courseMessage where field.number == 5:
                name = String(bytes: value.prefix(while: { $0 != 0 }), encoding: .utf8)
            default: break
            }
        }
        try reader.skip(definition.developerBytes)

        if definition.global == Self.recordMessage, let latitude, let longitude {
            points.append(GPXTrackPoint(
                coordinate: Coordinate(latitude: latitude, longitude: longitude),
                elevationM: elevation,
                time: time
            ))
        }
    }

    /// sint32 semicircles -> degrees; nil for the FIT invalid sentinel
    /// (0x7FFFFFFF) or an unexpected field size.
    private static func semicircles(_ value: ArraySlice<UInt8>, _ littleEndian: Bool) -> Double? {
        guard value.count == 4 else { return nil }
        let raw = Int32(bitPattern: UInt32(truncatingIfNeeded: uint(value, littleEndian)))
        guard raw != Int32.max else { return nil }
        return Double(raw) * Self.semicircleToDegrees
    }

    /// uint16/uint32 field; nil when the field holds its all-ones invalid
    /// sentinel or an unexpected size.
    private static func validUInt(_ value: ArraySlice<UInt8>, _ littleEndian: Bool) -> UInt64? {
        guard value.count == 2 || value.count == 4 else { return nil }
        let raw = uint(value, littleEndian)
        let invalid: UInt64 = value.count == 2 ? 0xFFFF : 0xFFFF_FFFF
        return raw == invalid ? nil : raw
    }

    private static func uint(_ value: ArraySlice<UInt8>, _ littleEndian: Bool) -> UInt64 {
        let ordered = littleEndian ? AnyCollection(value.reversed()) : AnyCollection(value)
        return ordered.reduce(0) { $0 << 8 | UInt64($1) }
    }
}

private struct FieldDefinition {
    var number: UInt8
    var size: Int
}

private struct MessageDefinition {
    var global: UInt16
    var littleEndian: Bool
    var fields: [FieldDefinition]
    /// Developer-data bytes trail the profile fields in every data message
    /// for this definition; measured here so they can be skipped.
    var developerBytes: Int

    init(reader: inout ByteReader, hasDeveloperFields: Bool) throws {
        try reader.skip(1) // reserved
        littleEndian = try reader.byte() == 0
        let globalBytes = try reader.slice(2)
        global = littleEndian
            ? UInt16(globalBytes.last!) << 8 | UInt16(globalBytes.first!)
            : UInt16(globalBytes.first!) << 8 | UInt16(globalBytes.last!)
        let fieldCount = try reader.byte()
        fields = try (0..<fieldCount).map { _ in
            let number = try reader.byte()
            let size = try reader.byte()
            try reader.skip(1) // base type — field sizes are trusted instead
            return FieldDefinition(number: number, size: Int(size))
        }
        var developerBytes = 0
        if hasDeveloperFields {
            let developerFieldCount = try reader.byte()
            for _ in 0..<developerFieldCount {
                try reader.skip(1) // field number
                developerBytes += Int(try reader.byte())
                try reader.skip(1) // developer data index
            }
        }
        self.developerBytes = developerBytes
    }
}

private struct ByteReader {
    let bytes: [UInt8]
    var offset: Int
    let limit: Int

    var isAtEnd: Bool { offset >= limit }

    mutating func byte() throws -> UInt8 {
        guard offset < limit else { throw FITParserError.malformedFile("truncated file") }
        defer { offset += 1 }
        return bytes[offset]
    }

    mutating func slice(_ count: Int) throws -> ArraySlice<UInt8> {
        guard offset + count <= limit else { throw FITParserError.malformedFile("truncated file") }
        defer { offset += count }
        return bytes[offset..<offset + count]
    }

    mutating func skip(_ count: Int) throws {
        guard offset + count <= limit else { throw FITParserError.malformedFile("truncated file") }
        offset += count
    }
}

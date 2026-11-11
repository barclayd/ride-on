import Foundation
import CryptoKit
import Engine
import Networking

/// One user-supplied route. Neither GPX's creator nor FIT's manufacturer identifies
/// the app that shared it; file imports always use honest, stable provenance.
public struct RouteFile: Sendable {
    public static let maximumBytes = 5_000_000
    public var name: String
    public let track: GPXTrack

    public enum Failure: LocalizedError {
        case unsupported, tooLarge, invalid, nameRequired
        public var errorDescription: String? {
            switch self {
            case .unsupported: "Choose a GPX or FIT route file."
            case .tooLarge: "This route is too large. Choose a file smaller than 5 MB."
            case .invalid: "This file doesn't contain a valid route. Export it as GPX or FIT and try again."
            case .nameRequired: "Give your route a name of up to 160 characters."
            }
        }
    }

    public init(data: Data, filename: String) throws {
        guard ["gpx", "fit"].contains((filename as NSString).pathExtension.lowercased()) else { throw Failure.unsupported }
        guard data.count <= Self.maximumBytes else { throw Failure.tooLarge }
        do {
            track = FITParser.isFIT(data: data) ? try FITParser.parse(data: data) : try GPXParser.parse(data: data)
        } catch { throw Failure.invalid }
        guard track.points.count >= 2, track.points.allSatisfy({ point in
            (-90...90).contains(point.coordinate.latitude) && (-180...180).contains(point.coordinate.longitude)
                && (point.elevationM?.isFinite ?? true)
        }), track.distanceKm > 0 else { throw Failure.invalid }
        let embedded = track.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let fallback = (filename as NSString).deletingPathExtension
        name = String((embedded.isEmpty ? fallback : embedded).prefix(160))
    }

    public static func read(_ url: URL, filename: String? = nil) throws -> Self {
        guard url.isFileURL else { throw Failure.unsupported }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        // Bound the read even when a provider doesn't supply a reliable file size.
        let data = try handle.read(upToCount: maximumBytes + 1) ?? Data()
        return try Self(data: data, filename: filename ?? url.lastPathComponent)
    }

    public struct Payload: Encodable, Sendable {
        public struct Source: Encodable, Sendable {
            public let providerId = "direct-import"
            public let externalId: String
        }
        public let source: Source
        public let gpx: String
        public let name: String
    }

    public func payload() throws -> Payload {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf16.count <= 160 else { throw Failure.nameRequired }
        let data = GPXWriter.data(name: name, coordinates: track.coordinates, elevations: track.points.map(\.elevationM))
        guard data.count <= Self.maximumBytes else { throw Failure.tooLarge }
        // The normalized content includes the name: safe retries and repeated shares
        // reuse the same library entry without overwriting another saved route.
        let fingerprint = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return Payload(source: .init(externalId: fingerprint), gpx: String(decoding: data, as: UTF8.self), name: name)
    }

    public struct Receipt: Decodable, Sendable {
        public struct SavedRoute: Decodable, Sendable { public let id: UUID; public let name: String }
        public let outcome: String
        public let route: SavedRoute
    }

    public func save() async throws -> Receipt {
        guard RideOnAPI.isSignedIn else {
            throw RideOnAPI.Failure(status: 401, code: "SIGN_IN_REQUIRED", message: "Open Ride On and sign in, then share this file again.")
        }
        return try await RideOnAPI.send("/route-imports", body: payload())
    }
}

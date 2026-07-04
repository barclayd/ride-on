import Foundation
import Models

/// Open-Meteo's free elevation API (no key needed):
/// `GET https://api.open-meteo.com/v1/elevation?latitude=a,b&longitude=c,d`
/// -> `{"elevation":[...]}`, max 100 points per request. Fills in tracks
/// whose GPX carries no `<ele>` tags (cycle.travel exports, for one).
/// ponytail: hits Open-Meteo straight from the app — move behind the worker
/// if we ever need caching or an API key.
public struct LiveOpenMeteoElevationClient: ElevationClient {
    public var urlSession: URLSession

    public init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    static let chunkSize = 100

    public func elevations(coordinates: [Coordinate]) async throws -> [Double?] {
        var result: [Double?] = []
        result.reserveCapacity(coordinates.count)
        for start in stride(from: 0, to: coordinates.count, by: Self.chunkSize) {
            let chunk = Array(coordinates[start..<min(start + Self.chunkSize, coordinates.count)])
            result.append(contentsOf: try await fetch(chunk))
        }
        return result
    }

    // Visible for testing.
    static func url(for chunk: [Coordinate]) -> URL {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/elevation")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: chunk.map { String(format: "%.5f", $0.latitude) }.joined(separator: ",")),
            URLQueryItem(name: "longitude", value: chunk.map { String(format: "%.5f", $0.longitude) }.joined(separator: ",")),
        ]
        return components.url!
    }

    private func fetch(_ chunk: [Coordinate]) async throws -> [Double?] {
        var (data, response) = try await urlSession.data(from: Self.url(for: chunk))
        // Open-Meteo rate-limits rapid bursts (observed 429 on a ~700-point
        // track's back-to-back chunks) — pause once and retry before giving up.
        if (response as? HTTPURLResponse)?.statusCode == 429 {
            try await Task.sleep(for: .seconds(2))
            (data, response) = try await urlSession.data(from: Self.url(for: chunk))
        }
        guard let http = response as? HTTPURLResponse else {
            throw ElevationClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ElevationClientError.requestFailed(status: http.statusCode)
        }
        struct Body: Decodable { var elevation: [Double?] }
        guard let decoded = try? JSONDecoder().decode(Body.self, from: data),
              decoded.elevation.count == chunk.count else {
            throw ElevationClientError.invalidResponse
        }
        return decoded.elevation
    }
}

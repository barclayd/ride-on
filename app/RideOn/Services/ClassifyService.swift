import Foundation
import RideOnCore

/// Live client for the deployed classification worker
/// (https://ride-on-api.barclaysd.workers.dev — see worker/CLAUDE.md).
/// POSTs `{"coordinates": [[lat,lon],...]}`, expects
/// `{surfaces, suggestedType, lengthKm, source, cacheHit}` on success or
/// `{error: {code, message}}` on a 4xx/5xx.
struct LiveClassifyClient: ClassifyClient {
    var baseURL: URL = URL(string: "https://ride-on-api.barclaysd.workers.dev")!
    var urlSession: URLSession = .shared

    private struct RequestBody: Encodable {
        var coordinates: [[Double]]
    }

    private struct ResponseBody: Decodable {
        var surfaces: [String: Double]
        var suggestedType: String
        var lengthKm: Double
    }

    func classify(coordinates: [Coordinate]) async throws -> ClassifyResult {
        var request = URLRequest(url: baseURL.appendingPathComponent("classify"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            RequestBody(coordinates: coordinates.map { [$0.latitude, $0.longitude] })
        )

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ClassifyClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ClassifyClientError.requestFailed(status: http.statusCode)
        }

        let decoded = try JSONDecoder().decode(ResponseBody.self, from: data)
        guard let suggestedType = SuggestedRouteType(rawValue: decoded.suggestedType) else {
            throw ClassifyClientError.invalidResponse
        }

        // Worker surfaces are length-share fractions (sum to ~1); convert
        // to distance km to match `SurfaceBreakdown`'s contract.
        let distanceKmBySurface = Dictionary(uniqueKeysWithValues: decoded.surfaces.compactMap { key, share -> (SurfaceType, Double)? in
            guard let surface = SurfaceType(rawValue: key) else { return nil }
            return (surface, share * decoded.lengthKm)
        })

        return ClassifyResult(
            surfaces: SurfaceBreakdown(distanceKmBySurface: distanceKmBySurface),
            suggestedType: suggestedType,
            lengthKm: decoded.lengthKm
        )
    }
}

import Foundation

/// Reusable HTTP boundary. App-specific sessions and error envelopes stay in
/// RideOnAPI; another Apple shell can supply its own endpoint and URLSession.
public struct HTTPTransport: Sendable {
    public typealias Load = @Sendable (URLRequest) async throws -> (Data, URLResponse)
    private let baseURL: URL
    private let load: Load

    public init(baseURL: URL, load: @escaping Load = { try await URLSession.shared.data(for: $0) }) {
        self.baseURL = baseURL
        self.load = load
    }

    public func data(_ path: String, method: String = "GET", query: [URLQueryItem] = [],
                     headers: [String: String] = [:], body: Data? = nil) async throws -> (Data, URLResponse) {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        for (field, value) in headers { request.setValue(value, forHTTPHeaderField: field) }
        try Task.checkCancellation()
        let response = try await load(request)
        try Task.checkCancellation()
        return response
    }
}

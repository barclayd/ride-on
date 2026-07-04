import Foundation

public protocol StravaTokenTransport: Sendable {
    func exchangeCode(_ code: String) async throws -> StravaToken
    func refresh(refreshToken: String) async throws -> StravaToken
}

public protocol StravaTokenPersisting: Sendable {
    func load() -> StravaToken?
    func save(_ token: StravaToken)
    func clear()
}

public struct KeychainStravaTokenPersistence: StravaTokenPersisting {
    private static let account = "com.danbarclay.rideon.strava.token"

    public init() {}

    public func load() -> StravaToken? {
        KeychainStore.get(account: Self.account).flatMap { try? JSONDecoder().decode(StravaToken.self, from: $0) }
    }

    public func save(_ token: StravaToken) {
        guard let data = try? JSONEncoder().encode(token) else { return }
        KeychainStore.set(data, account: Self.account)
    }

    public func clear() {
        KeychainStore.delete(account: Self.account)
    }
}

/// Token refresh state machine: holds the current token in memory (backed by
/// Keychain), refreshes it via `transport` when it's within a minute of
/// expiry, and rotates the stored refresh token on every refresh (Strava
/// issues a new one each time). Pure state machine over an injected
/// transport — no `URLSession` here, so it's unit-testable with a stub.
public actor StravaTokenManager {
    private var current: StravaToken?
    private let transport: any StravaTokenTransport
    private let persistence: any StravaTokenPersisting

    public init(transport: any StravaTokenTransport, persistence: any StravaTokenPersisting = KeychainStravaTokenPersistence()) {
        self.transport = transport
        self.persistence = persistence
        self.current = persistence.load()
    }

    public var isConnected: Bool { current != nil }

    public func completeAuthorization(code: String) async throws {
        let token = try await transport.exchangeCode(code)
        current = token
        persistence.save(token)
    }

    public func disconnect() {
        current = nil
        persistence.clear()
    }

    /// A currently-valid access token, refreshing first if it's expired or
    /// about to be (60s grace window).
    public func validAccessToken() async throws -> String {
        guard let token = current else { throw StravaClientError.notConnected }
        if token.expiresAt > Date().addingTimeInterval(60) {
            return token.accessToken
        }
        let refreshed = try await transport.refresh(refreshToken: token.refreshToken)
        current = refreshed
        persistence.save(refreshed)
        return refreshed.accessToken
    }
}

/// Hits the deployed worker's `/strava/token` + `/strava/refresh`
/// (worker/CLAUDE.md) — the client secret never ships in the app, so token
/// exchange/refresh always goes through there.
public struct LiveStravaTokenTransport: StravaTokenTransport {
    public var baseURL: URL
    public var urlSession: URLSession

    public init(baseURL: URL = URL(string: "https://ride-on-api.barclaysd.workers.dev")!, urlSession: URLSession = .shared) {
        self.baseURL = baseURL
        self.urlSession = urlSession
    }

    public func exchangeCode(_ code: String) async throws -> StravaToken {
        try await post(path: "strava/token", body: ["code": code])
    }

    public func refresh(refreshToken: String) async throws -> StravaToken {
        try await post(path: "strava/refresh", body: ["refresh_token": refreshToken])
    }

    private struct TokenResponse: Decodable {
        var access_token: String
        var refresh_token: String
        var expires_at: TimeInterval
        var athlete: Athlete?
        struct Athlete: Decodable { var id: Int }
    }

    private func post(path: String, body: [String: String]) async throws -> StravaToken {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw StravaClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw StravaClientError.requestFailed(status: http.statusCode) }

        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        return StravaToken(
            accessToken: decoded.access_token,
            refreshToken: decoded.refresh_token,
            expiresAt: Date(timeIntervalSince1970: decoded.expires_at),
            athleteID: decoded.athlete?.id
        )
    }
}

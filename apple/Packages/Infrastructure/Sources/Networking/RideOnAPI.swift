import Foundation
import CryptoKit

/// The Ride On API (docs/api.md). The session comes from the PKCE browser handoff
/// (docs/authentication.md, "iOS and macOS app") and lives in the keychain.
public enum RideOnAPI {
    public static let host = "api.ride-on.cc"
    /// Where the browser handoff ends; `ASWebAuthenticationSession` catches it (needs the
    /// `webcredentials:api.ride-on.cc` associated domain).
    public static let signInDonePath = "/auth/browser/done"
    static let base = URL(string: "https://\(host)")!

    private static let transport = HTTPTransport(baseURL: base)

    public enum Provider: String, Sendable { case apple, google }

    public struct Failure: LocalizedError, Sendable {
        public var status: Int
        public var code: String
        public var message: String
        /// Seconds to wait before trying again, from `Retry-After`.
        public var retryAfter: TimeInterval?
        public var errorDescription: String? { message }

        public init(status: Int, code: String, message: String, retryAfter: TimeInterval? = nil) {
            self.status = status
            self.code = code
            self.message = message
            self.retryAfter = retryAfter
        }
    }

    public struct SignInFlow: Sendable {
        public var url: URL
        var verifier: String
        var state: String
    }

    /// Application coordination needs account/login identity, never the credential itself.
    public struct SessionIdentity: Sendable {
        public let id: String
        public let accountID: String?
    }

    public static var sessionIdentity: SessionIdentity? {
        RideOnSession.shared.credentials.map { SessionIdentity(id: $0.id, accountID: $0.accountID) }
    }

    public static let sessionDidChange = RideOnSession.changed
    public static var isSignedIn: Bool { RideOnSession.shared.credentials != nil }
    public static func signOut() { RideOnSession.shared.signOut() }
    private static var token: String? { RideOnSession.shared.credentials?.token }

    /// Used only for the first request to our own host in a web authentication session.
    static var browserAuthorizationHeaders: [String: String] {
        token.map { ["Authorization": "Bearer \($0)"] } ?? [:]
    }

    // MARK: Sign-in

    /// Step one: the provider page to open in a web authentication session.
    public static func startSignIn(_ provider: Provider) async throws -> SignInFlow {
        let verifier = randomBase64URL(48) // 64 URL-safe characters
        let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = randomBase64URL(24)
        struct Start: Encodable { var provider, redirectUri, codeChallenge, state: String }
        struct Started: Decodable { var authorizationUrl: URL }
        let started: Started = try await send("/auth/browser/start", auth: false,
                                              body: Start(provider: provider.rawValue, redirectUri: redirectURI, codeChallenge: challenge, state: state))
        return SignInFlow(url: started.authorizationUrl, verifier: verifier, state: state)
    }

    /// Step two: swap the callback's one-time code for a session.
    public static func finishSignIn(callback: URL, flow: SignInFlow) async throws {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let code = items.first(where: { $0.name == "code" })?.value,
              items.first(where: { $0.name == "state" })?.value == flow.state else {
            throw Failure(status: 0, code: "SIGN_IN_INCOMPLETE", message: "Sign-in didn't finish. Try again.")
        }
        struct Exchange: Encodable { var code, codeVerifier, redirectUri: String }
        struct Session: Decodable { var token: String }
        let session: Session = try await send("/auth/browser/exchange", auth: false,
                                              body: Exchange(code: code, codeVerifier: flow.verifier, redirectUri: redirectURI))
        RideOnSession.shared.signIn(token: session.token)
    }

    private static var redirectURI: String { "https://\(host)\(signInDonePath)" }

    static func randomBase64URL(_ count: Int) -> String {
        var generator = SystemRandomNumberGenerator() // cryptographically secure on Apple platforms
        return base64URL(Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func invalidateProfile() async { await ProfileRequests.shared.invalidate() }

    // MARK: Requests

    /// GET, or POST (or `method`) with a JSON `body`. A 401 signs out, so the caller can show sign-in.
    public static func send<T: Decodable>(_ path: String, query: [URLQueryItem] = [], auth: Bool = true, method: String? = nil,
                                   headers: [String: String] = [:], body: (any Encodable)? = nil) async throws -> T {
        let data = try await data(path, query: query, auth: auth, method: method ?? (body == nil ? "GET" : "POST"),
                                  headers: headers, body: try body.map { try JSONEncoder().encode($0) })
        return try decoder.decode(T.self, from: data)
    }

    /// The same, for a response with nothing to read, like `204 No Content`.
    public static func send(_ path: String, query: [URLQueryItem] = [], method: String? = nil, headers: [String: String] = [:],
                     body: (any Encodable)? = nil) async throws {
        _ = try await data(path, query: query, method: method ?? (body == nil ? "GET" : "POST"),
                           headers: headers, body: try body.map { try JSONEncoder().encode($0) })
    }

    /// Shared profile reads prevent startup's settings and board loads from fetching twice.
    public static func data(_ path: String, query: [URLQueryItem] = [], auth: Bool = true,
                     method: String = "GET", headers: [String: String] = [:], body: Data? = nil) async throws -> Data {
        let credentials = RideOnSession.shared.credentials
        if path == "/users/me", method == "GET", auth, query.isEmpty, headers.isEmpty, let credentials {
            return try await ProfileRequests.shared.read(session: credentials.id) {
                try await request(path, query: query, auth: auth, method: method, headers: headers, body: body, credentials: credentials)
            }
        }
        if path == "/users/me", method != "GET" { await ProfileRequests.shared.invalidate() }
        let result = try await request(path, query: query, auth: auth, method: method, headers: headers, body: body, credentials: credentials)
        if path == "/users/me", method != "GET" { await ProfileRequests.shared.invalidate() }
        return result
    }

    private static func request(_ path: String, query: [URLQueryItem], auth: Bool, method: String,
                                headers: [String: String], body: Data?, credentials: RideOnSession.Credentials?) async throws -> Data {
        var requestHeaders = headers
        if auth, let credentials,
           !requestHeaders.keys.contains(where: { $0.caseInsensitiveCompare("Authorization") == .orderedSame }) {
            requestHeaders["Authorization"] = "Bearer \(credentials.token)"
        }
        let started = ContinuousClock.now
        let (data, response) = try await transport.data(path, method: method, query: query, headers: requestHeaders, body: body)
        LoadingLog.request(path, started: started, bytes: data.count)
        try Task.checkCancellation()
        if auth, credentials?.id != RideOnSession.shared.credentials?.id { throw CancellationError() }
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if auth, status == 401, let credentials { RideOnSession.shared.signOut(ifSession: credentials.id) }
            let detail = try? JSONDecoder().decode(APIErrorResponse.self, from: data).error
            throw Failure(status: status, code: detail?.code ?? "HTTP_\(status)",
                          message: detail?.message ?? HTTPURLResponse.localizedString(forStatusCode: status).capitalized,
                          retryAfter: http?.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init))
        }
        if auth, let credentials {
            RideOnSession.shared.refresh(http?.value(forHTTPHeaderField: "set-auth-token"), using: credentials)
            if path == "/users/me",
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let user = json["user"] as? [String: Any], let id = user["id"] as? String {
                RideOnSession.shared.identify(account: id, session: credentials.id)
            }
        }
        return data
    }

    /// The API writes instants with `toISOString()`: always UTC, always milliseconds.
    public static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            guard let date = (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string))
                ?? (try? Date.ISO8601FormatStyle().parse(string)) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not ISO 8601: \(string)"))
            }
            return date
        }
        return decoder
    }
}

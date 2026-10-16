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
    private static let tokenAccount = "ride-on-api-session"

    public enum Provider: String, Sendable { case apple, google }

    public struct Failure: LocalizedError, Sendable {
        public var status: Int
        public var code: String
        public var message: String
        /// Seconds to wait before trying again, from `Retry-After`.
        public var retryAfter: TimeInterval?
        public var errorDescription: String? { message }
    }

    public struct SignInFlow: Sendable {
        public var url: URL
        var verifier: String
        var state: String
    }

    public static var isSignedIn: Bool { token != nil }

    public static func signOut() {
        KeychainStore.delete(account: tokenAccount)
    }

    private static var token: String? {
        KeychainStore.get(account: tokenAccount).flatMap { String(data: $0, encoding: .utf8) }
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
        KeychainStore.set(Data(session.token.utf8), account: tokenAccount)
    }

    private static var redirectURI: String { "https://\(host)\(signInDonePath)" }

    private static func randomBase64URL(_ count: Int) -> String {
        var generator = SystemRandomNumberGenerator() // cryptographically secure on Apple platforms
        return base64URL(Data((0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) }))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: Requests

    /// GET, or POST (or `method`) with a JSON `body`. A 401 signs out, so the caller can show sign-in.
    static func send<T: Decodable>(_ path: String, query: [URLQueryItem] = [], auth: Bool = true, method: String? = nil,
                                   headers: [String: String] = [:], body: (any Encodable)? = nil) async throws -> T {
        try decoder.decode(T.self, from: await data(path, query: query, auth: auth, method: method, headers: headers, body: body))
    }

    /// The same, for a response with nothing to read, like `204 No Content`.
    static func send(_ path: String, query: [URLQueryItem] = [], method: String? = nil, headers: [String: String] = [:],
                     body: (any Encodable)? = nil) async throws {
        _ = try await data(path, query: query, auth: true, method: method, headers: headers, body: body)
    }

    private static func data(_ path: String, query: [URLQueryItem], auth: Bool, method: String?, headers: [String: String],
                             body: (any Encodable)?) async throws -> Data {
        var components = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method ?? (body == nil ? "GET" : "POST")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        for (field, value) in headers { request.setValue(value, forHTTPHeaderField: field) }
        if auth, let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        // Sessions refresh after a day of use; keep the newest token.
        if let refreshed = http?.value(forHTTPHeaderField: "set-auth-token"), !refreshed.isEmpty {
            KeychainStore.set(Data(refreshed.utf8), account: tokenAccount)
        }
        let status = http?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 { signOut() }
            let detail = try? JSONDecoder().decode(ErrorEnvelope.self, from: data).error
            throw Failure(status: status, code: detail?.code ?? "HTTP_\(status)",
                          message: detail?.message ?? HTTPURLResponse.localizedString(forStatusCode: status).capitalized,
                          retryAfter: http?.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init))
        }
        return data
    }

    private struct ErrorEnvelope: Decodable {
        struct Detail: Decodable { var code: String; var message: String }
        var error: Detail
    }

    /// The API writes instants with `toISOString()`: always UTC, always milliseconds.
    static var decoder: JSONDecoder {
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

import Foundation

/// Strava OAuth app config. The client id is public (embedded in every
/// Strava mobile app's authorize URL) — only the client secret is a secret,
/// and that never leaves the worker (`worker/CLAUDE.md`).
public enum StravaAuthConfig {
    public static let clientID = "262735"

    // Strava requires the redirect_uri host to sit within the API app's
    // "Authorization Callback Domain" (the deployed worker domain) — the
    // scheme can still be custom so the OS hands the callback to the app.
    public static let redirectScheme = "rideon"
    public static let redirectURI = "\(redirectScheme)://ride-on-api.barclaysd.workers.dev/strava-callback"
    public static let scope = "read,activity:read_all"

    public static var webAuthorizeURL: URL {
        authorizeURL(host: "www.strava.com", scheme: "https")
    }

    /// The Strava app's own app-to-app authorize scheme — tried first on
    /// iOS when the Strava app is installed (PLAN.md: "+ app-to-app when the
    /// Strava app present"); falls back to `webAuthorizeURL` via
    /// `ASWebAuthenticationSession` otherwise.
    public static var appAuthorizeURL: URL {
        authorizeURL(host: "strava.com", scheme: "strava")
    }

    private static func authorizeURL(host: String, scheme: String) -> URL {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.path = "/oauth/mobile/authorize"
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "approval_prompt", value: "auto"),
            URLQueryItem(name: "scope", value: scope),
        ]
        return components.url!
    }

    /// Parses `code`/`error` out of a `redirectURI` callback.
    public static func authorizationCode(from callbackURL: URL) -> Result<String, StravaAuthError> {
        let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            return .failure(.denied(error))
        }
        guard let code = items.first(where: { $0.name == "code" })?.value else {
            return .failure(.missingCode)
        }
        return .success(code)
    }
}

public enum StravaAuthError: Error, Sendable, Equatable {
    case denied(String)
    case missingCode
    case cancelled
}

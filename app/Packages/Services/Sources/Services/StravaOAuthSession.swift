import Foundation
import AuthenticationServices
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// `ASWebAuthenticationSession`-backed authorization-code fetch, with an
/// app-to-app fast path on iOS when the Strava app is installed (PLAN.md:
/// "+ app-to-app when the Strava app present"). macOS has no Strava app, so
/// it always goes through the web session — `ASWebAuthenticationSession` is
/// cross-platform, so that path works fine there too.
@MainActor
public final class StravaOAuthSession: NSObject {
    public override init() {}

    public func requestAuthorizationCode() async throws -> String {
        #if os(iOS)
        if await UIApplication.shared.canOpenURL(StravaAuthConfig.appAuthorizeURL) {
            return try await requestAppToAppCode()
        }
        #endif
        return try await requestWebCode()
    }

    #if os(iOS)
    private func requestAppToAppCode() async throws -> String {
        async let callback = StravaAuthCallbackRouter.shared.awaitCallback()
        await UIApplication.shared.open(StravaAuthConfig.appAuthorizeURL)
        return try await callback
    }
    #endif

    private func requestWebCode() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: StravaAuthConfig.webAuthorizeURL,
                callbackURLScheme: StravaAuthConfig.redirectScheme
            ) { callbackURL, error in
                if let error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        continuation.resume(throwing: StravaAuthError.cancelled)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }
                guard let callbackURL else {
                    continuation.resume(throwing: StravaAuthError.missingCode)
                    return
                }
                switch StravaAuthConfig.authorizationCode(from: callbackURL) {
                case .success(let code): continuation.resume(returning: code)
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }
    }
}

extension StravaOAuthSession: ASWebAuthenticationPresentationContextProviding {
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(iOS)
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first ?? ASPresentationAnchor()
        #else
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }
}

/// UI-triggered "Connect Strava" flow: real OAuth for the live client, the
/// fixture client's canned code for fixture-world (deterministic E2E, no
/// browser). Keeps the fixture/live branch out of Features UI code.
@MainActor
public enum StravaConnect {
    public static func connect(using client: any StravaClientProtocol) async throws {
        if client is FixtureStravaClient {
            try await client.exchangeToken(code: "fixture-auth-code")
        } else {
            let code = try await StravaOAuthSession().requestAuthorizationCode()
            try await client.exchangeToken(code: code)
        }
    }
}

#if os(iOS)
/// Routes the Strava app's app-to-app OAuth return (a normal `openURL` back
/// into `rideon://strava-callback`) to whichever `StravaOAuthSession` call is
/// waiting on it. Wired from `RideOnApp.onOpenURL`. iOS only — app-to-app
/// OAuth only exists on iOS (no Strava app on Mac).
@MainActor
public final class StravaAuthCallbackRouter {
    public static let shared = StravaAuthCallbackRouter()
    private var continuation: CheckedContinuation<String, Error>?
    private init() {}

    public func awaitCallback() async throws -> String {
        try await withCheckedThrowingContinuation { self.continuation = $0 }
    }

    /// Returns `true` if `url` was a Strava callback (so `RideOnApp` knows
    /// not to also try treating it as a GPX file open).
    @discardableResult
    public func handle(url: URL) -> Bool {
        guard url.scheme == StravaAuthConfig.redirectScheme else { return false }
        switch StravaAuthConfig.authorizationCode(from: url) {
        case .success(let code): continuation?.resume(returning: code)
        case .failure(let error): continuation?.resume(throwing: error)
        }
        continuation = nil
        return true
    }
}
#endif

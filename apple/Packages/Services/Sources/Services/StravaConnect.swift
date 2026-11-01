import Domain
import PlatformServices

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

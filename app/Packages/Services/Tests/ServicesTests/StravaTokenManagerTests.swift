import Testing
import Foundation
@testable import Services

/// In-memory stand-ins so the refresh state machine is testable with no
/// Keychain access and no network (StravaTokenManager itself has no
/// URLSession/Security.framework calls — only `transport`/`persistence` do).
private actor StubTransport: StravaTokenTransport {
    private(set) var exchangeCallCount = 0
    private(set) var refreshCallCount = 0
    private(set) var lastRefreshToken: String?
    var refreshResult: StravaToken

    init(refreshResult: StravaToken) {
        self.refreshResult = refreshResult
    }

    func exchangeCode(_ code: String) async throws -> StravaToken {
        exchangeCallCount += 1
        return StravaToken(accessToken: "access-\(code)", refreshToken: "refresh-\(code)", expiresAt: .distantFuture)
    }

    func refresh(refreshToken: String) async throws -> StravaToken {
        refreshCallCount += 1
        lastRefreshToken = refreshToken
        return refreshResult
    }
}

private final class StubPersistence: StravaTokenPersisting, @unchecked Sendable {
    private(set) var saved: StravaToken?
    private(set) var cleared = false

    func load() -> StravaToken? { saved }
    func save(_ token: StravaToken) { saved = token }
    func clear() { saved = nil; cleared = true }
}

@Suite("StravaTokenManager refresh state machine")
struct StravaTokenManagerTests {
    @Test("not connected before any authorization")
    func notConnectedInitially() async {
        let manager = StravaTokenManager(transport: StubTransport(refreshResult: .init(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture)), persistence: StubPersistence())
        #expect(await manager.isConnected == false)
    }

    @Test("validAccessToken throws when never authorized")
    func throwsWhenNotConnected() async {
        let manager = StravaTokenManager(transport: StubTransport(refreshResult: .init(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture)), persistence: StubPersistence())
        await #expect(throws: StravaClientError.self) {
            _ = try await manager.validAccessToken()
        }
    }

    @Test("completeAuthorization exchanges the code, persists, and connects")
    func completeAuthorization() async throws {
        let persistence = StubPersistence()
        let manager = StravaTokenManager(transport: StubTransport(refreshResult: .init(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture)), persistence: persistence)
        try await manager.completeAuthorization(code: "abc")
        #expect(await manager.isConnected == true)
        #expect(persistence.saved?.accessToken == "access-abc")
    }

    @Test("valid unexpired token is returned without refreshing")
    func returnsValidTokenWithoutRefresh() async throws {
        let transport = StubTransport(refreshResult: .init(accessToken: "should-not-be-used", refreshToken: "r2", expiresAt: .distantFuture))
        let manager = StravaTokenManager(transport: transport, persistence: StubPersistence())
        try await manager.completeAuthorization(code: "abc")
        let token = try await manager.validAccessToken()
        #expect(token == "access-abc")
        #expect(await transport.refreshCallCount == 0)
    }

    @Test("token within the 60s grace window triggers a refresh and rotates the refresh token")
    func refreshesNearExpiry() async throws {
        let refreshed = StravaToken(accessToken: "refreshed-access", refreshToken: "refreshed-refresh", expiresAt: .distantFuture)
        let transport = StubTransport(refreshResult: refreshed)
        let persistence = StubPersistence()
        // Seed persistence directly with a token expiring in 10s (within the grace window).
        persistence.save(StravaToken(accessToken: "stale", refreshToken: "old-refresh", expiresAt: Date().addingTimeInterval(10)))
        let manager = StravaTokenManager(transport: transport, persistence: persistence)

        let token = try await manager.validAccessToken()

        #expect(token == "refreshed-access")
        #expect(await transport.refreshCallCount == 1)
        #expect(await transport.lastRefreshToken == "old-refresh")
        #expect(persistence.saved?.accessToken == "refreshed-access")
    }

    @Test("already-expired token is refreshed")
    func refreshesExpiredToken() async throws {
        let refreshed = StravaToken(accessToken: "refreshed-access", refreshToken: "refreshed-refresh", expiresAt: .distantFuture)
        let transport = StubTransport(refreshResult: refreshed)
        let persistence = StubPersistence()
        persistence.save(StravaToken(accessToken: "expired", refreshToken: "old-refresh", expiresAt: Date().addingTimeInterval(-3600)))
        let manager = StravaTokenManager(transport: transport, persistence: persistence)

        let token = try await manager.validAccessToken()

        #expect(token == "refreshed-access")
        #expect(await transport.refreshCallCount == 1)
    }

    @Test("disconnect clears in-memory and persisted state")
    func disconnectClears() async throws {
        let persistence = StubPersistence()
        let manager = StravaTokenManager(transport: StubTransport(refreshResult: .init(accessToken: "a", refreshToken: "r", expiresAt: .distantFuture)), persistence: persistence)
        try await manager.completeAuthorization(code: "abc")
        await manager.disconnect()
        #expect(await manager.isConnected == false)
        #expect(persistence.cleared == true)
        await #expect(throws: StravaClientError.self) {
            _ = try await manager.validAccessToken()
        }
    }
}

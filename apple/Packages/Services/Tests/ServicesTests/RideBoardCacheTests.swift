import Networking
import Foundation
import Testing
import Domain
@testable import Services

private let routeID = "6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01"
private let start = ISO8601DateFormatter().date(from: "2026-10-23T10:00:00Z")!

private final class TestSession: @unchecked Sendable {
    private let lock = NSLock()
    private var value: (id: String, account: String?)? = ("login1", "rider1")
    var current: (id: String, account: String?)? { lock.withLock { value } }
    func set(_ next: (id: String, account: String?)?) { lock.withLock { value = next } }
}

private actor BoardServer {
    var counts: [String: Int] = [:]
    var offline = false
    var empty = false
    var routeVersion = 1
    var historyRevision = 1
    var delay: Duration = .zero
    var ignoreCancellation = false
    var geometryDelay: Duration = .zero
    var failGeometry = false
    var failSummaries = false
    var failPatch = false
    var missingHistoryRevision = false
    var score = 86
    var account = "rider1"
    var lastBody: Data?

    func configure(offline: Bool = false, empty: Bool = false, routeVersion: Int = 1, historyRevision: Int = 1,
                   delay: Duration = .zero, ignoreCancellation: Bool = false, geometryDelay: Duration = .zero, failGeometry: Bool = false,
                   failSummaries: Bool = false, failPatch: Bool = false, missingHistoryRevision: Bool = false,
                   score: Int = 86, account: String = "rider1") {
        self.offline = offline; self.empty = empty; self.routeVersion = routeVersion; self.historyRevision = historyRevision
        self.ignoreCancellation = ignoreCancellation
        self.delay = delay; self.geometryDelay = geometryDelay; self.failGeometry = failGeometry
        self.failSummaries = failSummaries; self.failPatch = failPatch; self.missingHistoryRevision = missingHistoryRevision
        self.score = score; self.account = account
    }

    func count(_ path: String) -> Int { counts[path, default: 0] }

    func fetch(_ path: String, body: Data?, method: String) async throws -> Data {
        counts[path, default: 0] += 1
        if offline { throw URLError(.notConnectedToInternet) }
        let text: String
        switch path {
        case "/route-selection": text = "{\"selection\":{\"routeIds\":\(empty ? "[]" : "[\"\(routeID)\"]"),\"version\":1}}"
        case "/users/me":
            if method == "PATCH", failPatch { throw RideOnAPI.Failure(status: 409, code: "CONFLICT", message: "Your dates weren't saved. Try again.") }
            text = """
            {"user":{"id":"\(account)","version":1,"settings":{"timeZone":"Europe/London",
              "planning":{"days":{"kind":"preset","preset":"tomorrow"},"window":"daylight"},
              "units":{"temperature":"C","windSpeed":"kmh"},"display":{"unit":"km"}}}}
            """
        case "/rides/summaries":
            if failSummaries { throw URLError(.timedOut) }
            text = "{\"summaries\":[{\"routeId\":\"\(routeID)\",\"lastRiddenOn\":\"2026-10-10\"}]\(missingHistoryRevision ? "" : ",\"historyRevision\":\(historyRevision)")}"
        case "/routes/\(routeID)": text = "{\"route\":{\"version\":\(routeVersion),\"source\":null}}"
        case "/routes/\(routeID)/geometry":
            try await Task.sleep(for: geometryDelay)
            if failGeometry { throw URLError(.timedOut) }
            text = "{\"version\":\(routeVersion),\"geometry\":{\"data\":\"_p~iF~ps|U_ulLnnqC_mqNvxq`@\"}}"
        case "/recommendations":
            lastBody = body
            let capturedScore = score
            if ignoreCancellation {
                let delay = delay
                try await Task.detached { try await Task.sleep(for: delay) }.value
            } else { try await Task.sleep(for: delay) }
            text = Self.recommendation(score: capturedScore)
        default: throw URLError(.unsupportedURL)
        }
        return Data(text.utf8)
    }

    static func recommendation(score: Int = 86, generated: String = "2026-10-23T10:00:00Z",
                               refresh: String = "2026-10-23T13:00:00Z", departure: String = "2026-10-24T09:00:00Z") -> String {
        let pick = """
        {"departureAt":"\(departure)","finishAt":"2026-10-24T11:00:00Z","score":\(score),
         "recommendationRef":"saved-assessment", "factors":{"temperature":90,"wind":80,"dryness":100},"standards":{"status":"meets"},
         "conditions":{"temperatureC":{"minimum":16,"maximum":16},"averageWindSpeedKph":10,
          "averageHeadwindKph":2,"averageTailwindKph":4,"averageCrosswindKph":3,"maximumGustKph":15,
          "maximumPrecipitationProbability":0,"distanceKm":35},"rideHours":[],"drawbacks":[]}
        """
        return """
        {"generatedAt":"\(generated)","algorithmVersion":"test-v1","timeZone":"Europe/London",
         "range":{"dates":["2026-10-24"]},"weather":{"refreshAt":"\(refresh)",
          "attribution":[{"text":"Weather source","url":"https://example.com/weather"}]},
         "rankings":[{"routeId":"\(routeID)","routeName":"Richmond","distanceKm":35,"ascentM":200,
           "estimatedDurationMinutes":120,"status":"assessed","best":\(pick),"alternatives":[]}],
         "unranked":[],"days":[{"date":"2026-10-24","selected":true,"recommendedRouteId":"\(routeID)","best":\(pick)}]}
        """
    }
}

private struct Harness {
    let server = BoardServer()
    let session = TestSession()
    let directory = URL.temporaryDirectory.appending(path: "RideBoardTests-\(UUID())")
    func repository() -> RideBoardRepository {
        RideBoardRepository(directory: directory, now: { start }, sessionIsCurrent: { [session] in session.current?.id == $0 },
                            fetch: { [server] in try await server.fetch($0, body: $1, method: $2) })
    }
    func clean() { try? FileManager.default.removeItem(at: directory) }
}

private func eventually(_ condition: @Sendable () async -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
    while !(await condition()) {
        guard ContinuousClock.now < deadline else { throw URLError(.timedOut) }
        try await Task.sleep(for: .milliseconds(5))
    }
}

struct RideBoardCacheTests {
    @Test func restoresCompleteBoardAcrossProcessWithoutNetwork() async throws {
        let h = Harness(); defer { h.clean() }
        let original = try await h.repository().refresh(session: "login1", account: "rider1")
        await h.server.configure(offline: true)
        let restored = try #require(await h.repository().restore(session: "login1", account: "rider1"))
        #expect(restored.board == (try original.board()))
        #expect(restored.board?.picks.first?.route.coordinates.count == 3)
        #expect(restored.board?.credits.first?.text == "Weather source")
        #expect(restored.board?.details.count == 1)
        #expect(restored.board?.picks.first?.recommendationRef == "saved-assessment")
        #expect(await h.server.count("/recommendations") == 1)
    }

    @Test func validatesContextAndOnlyDownloadsChangedGeometry() async throws {
        let h = Harness(); defer { h.clean() }
        let repo = h.repository()
        _ = try await repo.refresh(session: "login1", account: "rider1")
        _ = try await repo.refresh(session: "login1", account: "rider1")
        #expect(await h.server.count("/recommendations") == 1)
        #expect(await h.server.count("/routes/\(routeID)/geometry") == 1)
        await h.server.configure(historyRevision: 2)
        _ = try await repo.refresh(session: "login1", account: "rider1")
        #expect(await h.server.count("/recommendations") == 2)
        await h.server.configure(routeVersion: 2, historyRevision: 2)
        _ = try await repo.refresh(session: "login1", account: "rider1")
        #expect(await h.server.count("/recommendations") == 3)
        #expect(await h.server.count("/routes/\(routeID)/geometry") == 2)
        _ = try await repo.refresh(session: "login1", account: "rider1", force: true)
        #expect(await h.server.count("/recommendations") == 4)
        #expect(await h.server.count("/routes/\(routeID)/geometry") == 2)
    }

    @Test func missingHistoryRevisionNeverTreatsRankingAsValidated() async throws {
        let h = Harness(); defer { h.clean() }
        await h.server.configure(missingHistoryRevision: true)
        let repo = h.repository()
        _ = try await repo.refresh(session: "login1", account: "rider1")
        _ = try await repo.refresh(session: "login1", account: "rider1")
        #expect(await h.server.count("/recommendations") == 2)
    }

    @Test func emptyShortlistSurvivesRestartAndCorruptCacheIsIgnored() async throws {
        let h = Harness(); defer { h.clean() }
        await h.server.configure(empty: true)
        _ = try await h.repository().refresh(session: "login1", account: "rider1")
        let empty = await h.repository().restore(session: "login1", account: "rider1")
        #expect(empty != nil)
        #expect(empty?.board == nil)
        #expect(await h.server.count("/recommendations") == 0)
        let file = try #require(FileManager.default.contentsOfDirectory(at: h.directory, includingPropertiesForKeys: nil).first)
        try Data("broken".utf8).write(to: file)
        #expect(await h.repository().restore(session: "login1", account: "rider1") == nil)
    }

    @Test func newLoginAndOtherAccountCannotRestoreOldSnapshot() async throws {
        let h = Harness(); defer { h.clean() }
        _ = try await h.repository().refresh(session: "login1", account: "rider1")
        h.session.set(("login2", "rider1"))
        #expect(await h.repository().restore(session: "login2", account: "rider1") == nil)
        #expect(await h.repository().restore(session: "login2", account: "rider2") == nil)
    }

    @Test @MainActor func cachedContentAppearsBeforeNetworkAndSurvivesFailure() async throws {
        let h = Harness(); defer { h.clean() }
        _ = try await h.repository().refresh(session: "login1", account: "rider1")
        await h.server.configure(delay: .milliseconds(200))
        let store = RideBoardStore(repository: h.repository(), identity: { h.session.current }, now: { start })
        let refresh = Task { await store.refresh(force: true) }
        try await eventually { await MainActor.run { store.hasLoaded && store.isRefreshing } }
        #expect(store.board?.picks.first?.score == 86)
        await refresh.value
        await h.server.configure(offline: true)
        await store.refresh(force: true)
        #expect(store.hasLoaded)
        #expect(store.board?.picks.first?.score == 86)
        #expect(store.refreshError != nil)
        #expect(!store.isRefreshing)
    }

    @Test @MainActor func coldBoardAppearsBeforeOptionalGeometryAndFailuresDontRemoveIt() async throws {
        let h = Harness(); defer { h.clean() }
        await h.server.configure(geometryDelay: .milliseconds(200), failGeometry: true, failSummaries: true)
        let store = RideBoardStore(repository: h.repository(), identity: { h.session.current }, now: { start })
        let refresh = Task { await store.refresh() }
        try await eventually { await MainActor.run { store.board != nil && store.isRefreshing } }
        #expect(store.board?.picks.first?.route.coordinates.isEmpty == true)
        await refresh.value
        #expect(store.board != nil)
        #expect(store.refreshError != nil)
        #expect(!store.contextVerified)
    }

    @Test @MainActor func simultaneousActivationAndViewLoadCoalesce() async throws {
        let h = Harness(); defer { h.clean() }
        await h.server.configure(delay: .milliseconds(100))
        let store = RideBoardStore(repository: h.repository(), identity: { h.session.current }, now: { start })
        async let first: Void = store.refresh()
        async let second: Void = store.refresh()
        _ = await (first, second)
        #expect(await h.server.count("/recommendations") == 1)
    }

    @Test @MainActor func newerSettingsWinAndSignOutRejectsLateResponse() async throws {
        let h = Harness(); defer { h.clean() }
        let repo = h.repository()
        let store = RideBoardStore(repository: repo, identity: { h.session.current }, now: { start })
        await h.server.configure(delay: .milliseconds(200), ignoreCancellation: true)
        let older = Task { await store.refresh() }
        try await eventually { await h.server.count("/recommendations") == 1 }
        await h.server.configure(score: 72)
        await store.refresh(force: true)
        await older.value
        #expect(store.board?.picks.first?.score == 72)
        await h.server.configure(delay: .milliseconds(200), ignoreCancellation: true, score: 99)
        let late = Task { await store.refresh(force: true) }
        try await eventually { await h.server.count("/recommendations") == 3 }
        h.session.set(nil)
        await store.refresh()
        await late.value
        #expect(store.board == nil)
        #expect(!store.isSignedIn)
        #expect(!store.hasLoaded)
        h.session.set(("login1", "rider1"))
        #expect(await h.repository().restore(session: "login1", account: "rider1") == nil)
    }

    @Test @MainActor func backgroundExpirationPreservesPreviousSnapshot() async throws {
        let h = Harness(); defer { h.clean() }
        _ = try await h.repository().refresh(session: "login1", account: "rider1")
        await h.server.configure(historyRevision: 2, delay: .seconds(30), score: 99)
        let store = RideBoardStore(repository: h.repository(), identity: { h.session.current }, now: { start })
        let background = Task { await store.refreshInBackground() }
        try await eventually { await h.server.count("/recommendations") == 2 }
        background.cancel()
        await background.value
        #expect(store.board?.picks.first?.score == 86)
        #expect(!store.isRefreshing)
        let restored = await h.repository().restore(session: "login1", account: "rider1")
        #expect(restored?.board?.picks.first?.score == 86)
    }

    @Test @MainActor func expiredBackgroundTaskCannotCancelNewForegroundRefresh() async throws {
        let h = Harness(); defer { h.clean() }
        let store = RideBoardStore(repository: h.repository(), identity: { h.session.current }, now: { start })
        await h.server.configure(delay: .milliseconds(200), ignoreCancellation: true)
        let background = Task { await store.refreshInBackground() }
        try await eventually { await h.server.count("/recommendations") == 1 }
        await h.server.configure(delay: .milliseconds(100), score: 72)
        let foreground = Task { await store.refresh(force: true) }
        try await eventually { await h.server.count("/recommendations") == 2 }
        background.cancel()
        await foreground.value
        await background.value
        #expect(store.board?.picks.first?.score == 72)
        #expect(store.refreshError == nil)
    }

    @Test @MainActor func failedWindowSaveLeavesOldBoardAndReportsError() async throws {
        let h = Harness(); defer { h.clean() }
        let store = RideBoardStore(repository: h.repository(), identity: { h.session.current }, now: { start })
        await store.refresh()
        await h.server.configure(failPatch: true)
        await store.refresh(force: true, window: .init(days: [start], hours: .custom(leave: 540, back: 720)))
        #expect(store.board?.hours == .daylight)
        #expect(store.refreshError?.contains("dates weren't saved") == true)
        #expect(await h.server.count("/recommendations") == 1)
    }

    @Test func forecastExpiryMidnightDSTAndDepartureBoundReuse() throws {
        func snapshot(generated: String, refresh: String, departure: String) -> RideBoardSnapshot {
            .init(session: "login1", account: "rider1", fetchedAt: ISO8601DateFormatter().date(from: generated)!, profile: Data(),
                  recommendation: Data(BoardServer.recommendation(generated: generated, refresh: refresh, departure: departure).utf8),
                  routes: [:], summaries: [], hours: .daylight, contextKey: "context")
        }
        let daylight = snapshot(generated: "2026-10-24T10:00:00Z", refresh: "2026-10-26T13:00:00Z", departure: "2026-10-26T09:00:00Z")
        #expect(daylight.refreshDate() == ISO8601DateFormatter().date(from: "2026-10-24T23:00:00Z"))
        let dst = snapshot(generated: "2026-10-25T10:00:00Z", refresh: "2026-10-26T13:00:00Z", departure: "2026-10-26T09:00:00Z")
        #expect(dst.refreshDate() == ISO8601DateFormatter().date(from: "2026-10-26T00:00:00Z"))
        let departure = snapshot(generated: "2026-10-23T10:00:00Z", refresh: "2026-10-23T13:00:00Z", departure: "2026-10-23T11:00:00Z")
        #expect(departure.canReuse(at: start))
        #expect(!departure.canReuse(at: start.addingTimeInterval(3600)))
        #expect(!departure.canReuse(at: start.addingTimeInterval(-1)))
    }
}

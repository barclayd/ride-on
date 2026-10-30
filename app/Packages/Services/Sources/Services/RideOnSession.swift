import Foundation
import os

/// A login ID survives process launches and token rotation, but changes on every sign-in.
/// This prevents a late response or an old account cache crossing a sign-out boundary.
final class RideOnSession: @unchecked Sendable {
    static let shared = RideOnSession()
    static let changed = Notification.Name("RideOnSessionChanged")
    struct Credentials: Sendable {
        var id: String
        var token: String
        var accountID: String?
    }
    private let lock = NSLock()
    private let tokenKey = "ride-on-api-session"
    private let loginKey = "ride-on-api-login"
    private let accountKey = "ride-on-api-account"

    private func string(_ key: String) -> String? {
        KeychainStore.get(account: key).flatMap { String(data: $0, encoding: .utf8) }
    }

    var credentials: Credentials? {
        lock.withLock {
            guard let token = string(tokenKey) else { return nil }
            let id = string(loginKey) ?? UUID().uuidString
            if string(loginKey) == nil { KeychainStore.set(Data(id.utf8), account: loginKey) }
            return Credentials(id: id, token: token, accountID: string(accountKey))
        }
    }

    func signIn(token: String) {
        lock.withLock {
            KeychainStore.delete(account: accountKey)
            KeychainStore.set(Data(UUID().uuidString.utf8), account: loginKey)
            KeychainStore.set(Data(token.utf8), account: tokenKey)
        }
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func signOut(ifSession expected: String? = nil) {
        let changed = lock.withLock {
            if let expected, string(loginKey) != expected { return false }
            for key in [tokenKey, loginKey, accountKey] { KeychainStore.delete(account: key) }
            return true
        }
        if changed { NotificationCenter.default.post(name: Self.changed, object: nil) }
    }

    func identify(account: String, session: String) {
        lock.withLock {
            guard string(loginKey) == session else { return }
            KeychainStore.set(Data(account.utf8), account: accountKey)
        }
    }

    func refresh(_ token: String?, using original: Credentials) {
        guard let token, !token.isEmpty else { return }
        lock.withLock {
            guard string(loginKey) == original.id, string(tokenKey) == original.token else { return }
            KeychainStore.set(Data(token.utf8), account: tokenKey)
        }
    }
}

actor ProfileRequests {
    static let shared = ProfileRequests()
    private var generation = UUID()
    private var pending: (session: String, task: Task<Data, Error>)?
    private var recent: (session: String, data: Data, at: Date)?

    func invalidate() {
        generation = UUID()
        pending?.task.cancel()
        pending = nil
        recent = nil
    }

    func read(session: String, fetch: @escaping @Sendable () async throws -> Data) async throws -> Data {
        try Task.checkCancellation()
        if let recent, recent.session == session, Date.now.timeIntervalSince(recent.at) < 2 { return recent.data }
        if let pending, pending.session == session {
            let id = generation
            let data = try await pending.task.value
            try Task.checkCancellation()
            guard generation == id else { throw CancellationError() }
            return data
        }
        if pending != nil { invalidate() }
        let id = generation
        let task = Task { try await fetch() }
        pending = (session, task)
        do {
            let data = try await task.value
            guard generation == id else { throw CancellationError() }
            recent = (session, data, .now)
            pending = nil
            return data
        } catch {
            if generation == id { pending = nil }
            throw error
        }
    }
}

enum LoadingLog {
    static let logger = Logger(subsystem: "com.danbarclay.rideon", category: "Loading")
    static func request(_ path: String, started: ContinuousClock.Instant, bytes: Int) {
        // Endpoint names only: never log request bodies, account IDs or route IDs.
        var parts = path.split(separator: "/").map(String.init)
        if parts.count > 1, ["routes", "tracked-rides"].contains(parts[0]) { parts[1] = ":id" }
        let endpoint = "/" + parts.joined(separator: "/")
        logger.debug("\(endpoint, privacy: .public): \(String(describing: started.duration(to: .now)), privacy: .public), \(bytes) bytes")
    }
}

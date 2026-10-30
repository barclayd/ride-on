import Foundation
import Observation
import Models

/// App-owned state: refreshing never replaces a usable board with a loading/error screen.
@MainActor @Observable
public final class RideBoardStore {
    public private(set) var board: RideBoard?
    public private(set) var hasLoaded = false
    public private(set) var isRefreshing = false
    public private(set) var isSignedIn = false
    public private(set) var refreshError: String?
    public private(set) var refreshAt: Date?
    public private(set) var nextRefresh: Date?
    public private(set) var fetchedAt: Date?
    public private(set) var contextVerified = false
    private var session: String?
    private var account: String?
    private var operation = UUID()
    private var pending: Task<Void, Never>?
    private var backgroundOwner: UUID?
    private var invalidatedByEdit = false
    private var enrichmentFailed = false
    private var lastAttempt: Date?
    private var retryAfter: Date?
    private let repository: RideBoardRepository
    private let identity: @Sendable () -> (id: String, account: String?)?
    private let now: @Sendable () -> Date
    private let live: Bool

    public convenience init(live: Bool = true) {
        self.init(repository: .shared, live: live, identity: {
            RideOnSession.shared.credentials.map { ($0.id, $0.accountID) }
        })
    }

    init(repository: RideBoardRepository, live: Bool = true,
         identity: @escaping @Sendable () -> (id: String, account: String?)?,
         now: @escaping @Sendable () -> Date = { .now }) {
        self.repository = repository
        self.live = live
        self.identity = identity
        self.now = now
        isSignedIn = live && identity() != nil
    }

    /// Settings saves/window edits pass force=true and supersede any older operation.
    public func refresh(force: Bool = false, window: RideWindow? = nil) async {
        await load(force: force, window: window)
    }

    private func load(force: Bool = false, window: RideWindow? = nil, background: UUID? = nil) async {
        guard live else { return }
        let current = identity()
        if current?.id != session {
            let oldAccount = account
            cancelRefresh()
            board = nil
            hasLoaded = false
            refreshError = nil
            refreshAt = nil
            nextRefresh = nil
            fetchedAt = nil
            contextVerified = false
            invalidatedByEdit = false
            enrichmentFailed = false
            lastAttempt = nil
            retryAfter = nil
            session = current?.id
            account = current?.account
            // Await removal before allowing this account's next session to restore.
            if oldAccount != nil { await repository.invalidate(account: oldAccount) }
            guard identity()?.id == current?.id else { return }
        }
        isSignedIn = current != nil
        guard let current else { return }
        if let pending, !force, window == nil {
            // A scheduled background wake needn't join an already running foreground refresh.
            if background == nil { await pending.value }
            return
        }
        // App activation and initial appearance often arrive together. This is only a short
        // debounce; the server's forecast deadline still controls ranking reuse.
        if !force, window == nil, let lastAttempt, hasLoaded,
           now() < (retryAfter ?? lastAttempt.addingTimeInterval(5)) { return }
        pending?.cancel()
        operation = UUID()
        let id = operation
        backgroundOwner = background
        isRefreshing = true
        lastAttempt = now()
        let started = ContinuousClock.now
        let task = Task { [weak self] in
            guard let self else { return }
            if !hasLoaded, let content = await repository.restore(session: current.id, account: current.account), valid(id, session: current.id) {
                apply(content)
                LoadingLog.logger.debug("First usable saved board: \(String(describing: started.duration(to: .now)), privacy: .public)")
            }
            if force || window != nil { invalidatedByEdit = true }
            do {
                let snapshot = try await repository.refresh(session: current.id, account: current.account, window: window, force: force) { [weak self] content in
                    await self?.publish(content, operation: id, session: current.id)
                }
                guard valid(id, session: current.id) else { return }
                // Mapping remains on the repository actor, including on a cache hit.
                if let content = await repository.restore(session: current.id, account: snapshot.account), valid(id, session: current.id) { apply(content) }
                guard valid(id, session: current.id) else { return }
                refreshError = enrichmentFailed ? "Some route details couldn't update. Pull down to retry." : nil
                retryAfter = nil
                LoadingLog.logger.debug("Board refresh complete: \(String(describing: started.duration(to: .now)), privacy: .public)")
            } catch {
                guard operation == id else { return }
                if identity()?.id != current.id {
                    await refresh()
                    return
                }
                if !(error is CancellationError), !Task.isCancelled {
                    refreshError = error.localizedDescription
                    retryAfter = now().addingTimeInterval(60)
                }
            }
            guard operation == id else { return }
            isRefreshing = false
            pending = nil
            if let retryAfter { nextRefresh = retryAfter }
            else if board == nil { nextRefresh = now().addingTimeInterval(5 * 60) }
            else if enrichmentFailed { nextRefresh = now().addingTimeInterval(60) }
            else { nextRefresh = max(refreshAt ?? now(), now().addingTimeInterval(60)) }
        }
        pending = task
        await task.value
    }

    private func valid(_ id: UUID, session: String) -> Bool {
        operation == id && identity()?.id == session && !Task.isCancelled
    }

    private func publish(_ content: RideBoardContent, operation id: UUID, session: String) {
        guard valid(id, session: session) else { return }
        apply(content)
        refreshError = nil
    }

    private func apply(_ content: RideBoardContent) {
        board = content.board
        refreshAt = content.refreshAt
        fetchedAt = content.fetchedAt
        contextVerified = content.contextVerified
        enrichmentFailed = content.enrichmentFailed
        invalidatedByEdit = false
        account = content.account
        hasLoaded = true
    }

    public func cancelRefresh() {
        operation = UUID()
        pending?.cancel()
        pending = nil
        backgroundOwner = nil
        isRefreshing = false
        lastAttempt = nil
    }

    /// Called by the SwiftUI background task; expiration must cancel the actual network work.
    public func refreshInBackground() async {
        let owner = UUID()
        await withTaskCancellationHandler {
            guard !Task.isCancelled else { return }
            await load(background: owner)
        } onCancel: {
            Task { @MainActor in
                guard self.backgroundOwner == owner else { return }
                self.cancelRefresh()
                // Profile requests are shared tasks; cancel their URLSession work too.
                await ProfileRequests.shared.invalidate()
            }
        }
    }

    public func isPreviousPlan(at date: Date) -> Bool {
        guard let board else { return false }
        return invalidatedByEdit || board.expired || board.window.end <= date || (refreshAt ?? .distantPast) <= date
    }

    public var status: String? {
        if let refreshError { return hasLoaded ? "Showing saved rides. \(refreshError)" : refreshError }
        if isRefreshing { return hasLoaded ? "Updating rides…" : nil }
        if isPreviousPlan(at: now()) { return "Showing your last forecast. Pull down to update." }
        return nil
    }
}

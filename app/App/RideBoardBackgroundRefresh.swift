#if os(iOS)
import BackgroundTasks
import Services
import os

enum RideBoardBackgroundRefresh {
    static let identifier = "com.danbarclay.rideon.refresh"

    @MainActor static func schedule(after date: Date?) {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        guard !FixtureWorld.isEnabled, RideOnAPI.isSignedIn else { return }
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = max(date ?? Date.now.addingTimeInterval(15 * 60), .now.addingTimeInterval(60))
        do { try BGTaskScheduler.shared.submit(request) }
        catch {
            // Disabled background refresh is normal: disk restoration and activation still work.
            Logger(subsystem: "com.danbarclay.rideon", category: "Loading")
                .debug("Background refresh wasn't scheduled: \(error.localizedDescription, privacy: .public)")
        }
    }
}
#endif

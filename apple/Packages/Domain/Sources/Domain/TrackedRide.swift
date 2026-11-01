import Foundation

/// The rider's tracked ride (docs/ride-tracking-api.md): the departure they accepted, and what the
/// latest forecast check found against it. Presentation values; `Services.RideTracker` builds it.
public struct TrackedRide: Hashable, Sendable, Identifiable {
    public var id: String
    public var routeId: UUID
    public var start: Date
    public var finish: Date
    /// The score when tracking started. It never changes.
    public var originalScore: Int
    /// The last successful check's score; `nil` before one.
    public var latestScore: Int?
    public var check: Check

    /// The `RideBoard.Pick.id` of the same route and departure.
    public var pickID: String { "\(routeId)@\(start.timeIntervalSinceReferenceDate)" }

    public init(id: String, routeId: UUID, start: Date, finish: Date, originalScore: Int, latestScore: Int? = nil, check: Check) {
        self.id = id
        self.routeId = routeId
        self.start = start
        self.finish = finish
        self.originalScore = originalScore
        self.latestScore = latestScore
        self.check = check
    }

    public enum Check: Hashable, Sendable {
        case checking
        /// A current comparison with the forecast when tracking started; no changes means none.
        case checked(at: Date, changes: [Change])
        /// The last check is out of date, or there hasn't been one.
        case due(lastChecked: Date?)
        /// The last attempt failed. It never means nothing changed.
        case failed(Reason, lastChecked: Date?)
        /// Departure has come, so there's nothing more to check.
        case closed

        /// When a check last succeeded, if it says.
        public var lastChecked: Date? {
            switch self {
            case .checked(let at, _): at
            case .due(let last), .failed(_, let last): last
            case .checking, .closed: nil
            }
        }
    }

    /// What's different since tracking started, most important first.
    public enum Change: Hashable, Sendable {
        /// A minimum standard that passed when tracking started now fails.
        case standard(Standard, actual: Double, limit: Double)
        /// Rain is now forecast where it wasn't.
        case rain
        /// Another route now ranks above it; `name` when the API says.
        case betterRoute(name: String?, start: Date)
        /// Another departure of the same route now ranks above it.
        case betterTime(start: Date)
        /// The rounded score's move, never zero.
        case score(Int)
        /// Some other options couldn't be checked, so a better one may be missing.
        case incomplete
    }

    public enum Standard: Hashable, Sendable { case gust, cold, heat, rainChance, rainRate }

    public enum Reason: Hashable, Sendable { case routeUnavailable, noLongerFits, forecastUnavailable, missingElevation, other }
}

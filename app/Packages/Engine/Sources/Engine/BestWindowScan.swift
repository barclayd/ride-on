import Foundation
import Models

/// "When on this day should the ride start?" — the shared-window search
/// behind the Ride tab's per-day ranking. One window per day: the candidate
/// start whose *top* route scores highest wins, and every route is then
/// ranked at that start. Pure and deterministic, like `BestDayScan`.
public enum BestWindowScan {
    public struct WindowRanking: Sendable {
        /// The chosen ride-start instant (the shared "best window" opens here).
        public var start: Date
        public var ranked: [RankedRide]

        public init(start: Date, ranked: [RankedRide]) {
            self.start = start
            self.ranked = ranked
        }
    }

    /// Candidate ride-start instants on `day`: every whole hour inside the
    /// rider's preferred riding window whose `hoursAvailable`-long ride still
    /// finishes inside it (and by `backBy`, when set). `earliest` clamps the
    /// front (pass "now" when `day` is today). Never empty when the riding
    /// window itself is non-empty — a window too short for the ride degrades
    /// to its single opening hour rather than "no recommendation".
    ///
    /// ponytail: hoursAvailable stands in for each route's real duration when
    /// bounding the search — per-route bounds would mean per-route windows,
    /// which the design deliberately rejected in favour of one shared window.
    public static func candidateStarts(
        on day: Date,
        ridingWindowMinutes: ClosedRange<Int>,
        hoursAvailable: Double,
        backBy: Date? = nil,
        earliest: Date? = nil,
        calendar: Calendar = .current
    ) -> [Date] {
        let startOfDay = calendar.startOfDay(for: day)
        let windowOpen = startOfDay.addingTimeInterval(Double(ridingWindowMinutes.lowerBound) * 60)
        var windowClose = startOfDay.addingTimeInterval(Double(ridingWindowMinutes.upperBound) * 60)
        if let backBy { windowClose = min(windowClose, backBy) }

        var first = windowOpen
        if let earliest, earliest > first {
            // Snap up to the next whole hour so candidates stay hour-aligned
            // with the forecast samples.
            let interval = earliest.timeIntervalSince(windowOpen)
            first = windowOpen.addingTimeInterval((interval / 3600).rounded(.up) * 3600)
        }

        let lastStart = windowClose.addingTimeInterval(-hoursAvailable * 3600)
        guard first <= lastStart else {
            // Window shorter than the ride (or nearly closed): the single
            // earliest viable start is still a better answer than nothing.
            return first < windowClose ? [first] : []
        }

        return stride(from: 0.0, through: lastStart.timeIntervalSince(first), by: 3600)
            .map { first.addingTimeInterval($0) }
    }

    /// Ranks every route at every candidate start (each route in its own
    /// context, built by the caller) and returns the start whose best route
    /// scores highest, with the full ranking at that start. Earlier starts
    /// win ties — no reason to wait for the same conditions.
    public static func best(
        starts: [Date],
        scorer: WeightedScorer,
        contexts: (Date) -> [(route: Route, context: DailyContext)]
    ) -> WindowRanking? {
        starts
            .compactMap { start -> WindowRanking? in
                let ranked = contexts(start)
                    .compactMap { scorer.rank(routes: [$0.route], context: $0.context).first }
                    .sorted { lhs, rhs in
                        if lhs.score != rhs.score { return lhs.score > rhs.score }
                        return lhs.route.id.uuidString < rhs.route.id.uuidString
                    }
                guard !ranked.isEmpty else { return nil }
                return WindowRanking(start: start, ranked: ranked)
            }
            .sorted { lhs, rhs in
                let l = lhs.ranked.first?.score ?? 0
                let r = rhs.ranked.first?.score ?? 0
                if l != r { return l > r }
                return lhs.start < rhs.start
            }
            .first
    }
}

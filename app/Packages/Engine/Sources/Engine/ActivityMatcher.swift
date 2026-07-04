import Foundation
import Models

/// Matches a Strava/HealthKit activity's GPS trace against a rider's saved
/// routes by geometry overlap (`GPXGeometry.overlapFraction`) — same
/// approach as the novelty factor's route-vs-route check. Pure/platform-free
/// so both `LiveStravaClient`'s activity fetch and `LiveHealthKitStore`'s
/// workout-route fetch (Services package) can share it.
public enum ActivityMatcher {
    /// Minimum fraction of the activity's length that must run within
    /// `GPXGeometry`'s overlap threshold of a candidate route to count as a
    /// match. 0.6 tolerates a shorter/longer ride on the same loop (extra
    /// warm-up loop, early turnaround) while rejecting a different route
    /// that merely crosses the same road for a block.
    public static let matchThreshold = 0.6

    /// Best-matching route id for `activityCoordinates`, or `nil` if no
    /// candidate clears `matchThreshold`.
    public static func bestMatch(
        activityCoordinates: [Coordinate],
        candidates: [(id: UUID, coordinates: [Coordinate])],
        threshold: Double = matchThreshold
    ) -> UUID? {
        guard activityCoordinates.count > 1 else { return nil }
        return candidates
            .map { (id: $0.id, overlap: GPXGeometry.overlapFraction(activityCoordinates, $0.coordinates)) }
            .filter { $0.overlap >= threshold }
            .max { $0.overlap < $1.overlap }?
            .id
    }
}

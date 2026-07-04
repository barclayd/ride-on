import Foundation
import Testing
import Models
@testable import Engine

@Suite("ActivityMatcher")
struct ActivityMatcherTests {
    private func line(from: Coordinate, to: Coordinate, points: Int) -> [Coordinate] {
        (0..<points).map { i in
            let t = Double(i) / Double(points - 1)
            return Coordinate(
                latitude: from.latitude + (to.latitude - from.latitude) * t,
                longitude: from.longitude + (to.longitude - from.longitude) * t
            )
        }
    }

    @Test("matches the route whose geometry the activity actually overlaps")
    func matchesOverlappingRoute() {
        let routeA = line(from: Coordinate(latitude: 51.75, longitude: -0.80), to: Coordinate(latitude: 51.80, longitude: -0.80), points: 20)
        let routeB = line(from: Coordinate(latitude: 52.00, longitude: -1.20), to: Coordinate(latitude: 52.05, longitude: -1.20), points: 20)
        let activity = routeA // same trace as route A

        let match = ActivityMatcher.bestMatch(
            activityCoordinates: activity,
            candidates: [(id: UUID(), coordinates: routeB), (id: UUID(), coordinates: routeA)]
        )
        #expect(match != nil)

        let routeAID = UUID()
        let routeBID = UUID()
        let matchByID = ActivityMatcher.bestMatch(
            activityCoordinates: activity,
            candidates: [(id: routeBID, coordinates: routeB), (id: routeAID, coordinates: routeA)]
        )
        #expect(matchByID == routeAID)
    }

    @Test("returns nil when no candidate clears the overlap threshold")
    func returnsNilWhenNoOverlap() {
        let activity = line(from: Coordinate(latitude: 51.75, longitude: -0.80), to: Coordinate(latitude: 51.80, longitude: -0.80), points: 20)
        let unrelated = line(from: Coordinate(latitude: 40.0, longitude: 20.0), to: Coordinate(latitude: 41.0, longitude: 21.0), points: 20)

        let match = ActivityMatcher.bestMatch(
            activityCoordinates: activity,
            candidates: [(id: UUID(), coordinates: unrelated)]
        )
        #expect(match == nil)
    }

    @Test("degenerate activity trace (0-1 points) never matches")
    func degenerateActivityNeverMatches() {
        let candidate = line(from: Coordinate(latitude: 51.75, longitude: -0.80), to: Coordinate(latitude: 51.80, longitude: -0.80), points: 20)
        #expect(ActivityMatcher.bestMatch(activityCoordinates: [], candidates: [(id: UUID(), coordinates: candidate)]) == nil)
        #expect(ActivityMatcher.bestMatch(activityCoordinates: [candidate[0]], candidates: [(id: UUID(), coordinates: candidate)]) == nil)
    }
}

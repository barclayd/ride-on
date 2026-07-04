#if os(iOS)
import Foundation
import HealthKit
import CoreLocation
import Models
import Engine

/// Contextual HealthKit authorization for cycling workouts + routes — called
/// from `PermissionPrimingSheet.onAllow` once the user opts into ride
/// matching (DESIGN-SYSTEM.md §9's contextual-priming rule; this is the real
/// system prompt behind that UI).
public enum HealthAuthorization {
    public static func requestCyclingAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let store = HKHealthStore()
        try await store.requestAuthorization(toShare: [], read: [HKObjectType.workoutType(), HKSeriesType.workoutRoute()])
    }
}

/// Real HealthKit cycling-workout + `HKWorkoutRoute` matching (PLAN.md,
/// iOS-only — Mac gets ride history via CloudKit sync of what iOS wrote). An
/// unauthorized query just returns no samples rather than throwing, so this
/// stays silent until `HealthAuthorization` has actually been granted.
public struct LiveHealthKitStore: HealthStoreProviding {
    private let store = HKHealthStore()

    public init() {}

    public func recentCyclingRides(since: Date, matchingAgainst routes: [Route]) async throws -> [RideLog] {
        guard HKHealthStore.isHealthDataAvailable() else { return [] }
        let workouts = try await cyclingWorkouts(since: since)
        let candidates = routes.map { (id: $0.id, coordinates: $0.coordinates) }

        var logs: [RideLog] = []
        for workout in workouts {
            let coordinates = try await routeCoordinates(for: workout)
            guard
                !coordinates.isEmpty,
                let matchedID = ActivityMatcher.bestMatch(activityCoordinates: coordinates, candidates: candidates)
            else { continue }
            logs.append(RideLog(routeID: matchedID, date: workout.startDate))
        }
        return logs
    }

    private func cyclingWorkouts(since: Date) async throws -> [HKWorkout] {
        let datePredicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
        let workoutPredicate = HKQuery.predicateForWorkouts(with: .cycling)
        let compound = NSCompoundPredicate(andPredicateWithSubpredicates: [datePredicate, workoutPredicate])

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKObjectType.workoutType(),
                predicate: compound,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: (samples as? [HKWorkout]) ?? [])
                }
            }
            store.execute(query)
        }
    }

    private func routeCoordinates(for workout: HKWorkout) async throws -> [Coordinate] {
        let predicate = HKQuery.predicateForObjects(from: workout)
        let routeSamples: [HKWorkoutRoute] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: HKSeriesType.workoutRoute(), predicate: predicate, limit: 1, sortDescriptors: nil) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: (samples as? [HKWorkoutRoute]) ?? [])
                }
            }
            store.execute(query)
        }
        guard let route = routeSamples.first else { return [] }

        return try await withCheckedThrowingContinuation { continuation in
            var coordinates: [Coordinate] = []
            let query = HKWorkoutRouteQuery(route: route) { _, locations, done, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                coordinates.append(contentsOf: (locations ?? []).map { Coordinate(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude) })
                if done {
                    continuation.resume(returning: coordinates)
                }
            }
            store.execute(query)
        }
    }
}
#endif

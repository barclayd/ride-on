import SwiftUI
import SwiftData
import Models
import Services
import SharedUI

/// Ride history across all routes — the novelty factor's raw material.
/// Strava/HealthKit sync (`StravaActivitySyncService`, `LiveHealthKitStore`)
/// write into this same store.
struct RideLogView: View {
    @Query(sort: \RideLogModel.date, order: .reverse) private var logs: [RideLogModel]
    @Query private var routes: [RouteModel]
    @Environment(\.services) private var services

    var body: some View {
        List(logs) { log in
            HStack {
                VStack(alignment: .leading) {
                    Text(routeName(for: log))
                        .font(.headline)
                    Text(log.date.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if log.source == .strava, let activityID = log.stravaActivityID {
                        Link("View on Strava", destination: services.strava.activityWebURL(activityID: activityID))
                            .font(.caption)
                    }
                }
                Spacer()
                Text(log.source.rawValue.capitalized)
                    .tagCapsule()
            }
        }
        .overlay {
            if logs.isEmpty {
                ContentUnavailableView("No Rides Logged", systemImage: "checkmark.circle")
            }
        }
        .navigationTitle("Ride Log")
    }

    private func routeName(for log: RideLogModel) -> String {
        routes.first { $0.id == log.routeID }?.name ?? "Unknown Route"
    }
}

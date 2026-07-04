import SwiftUI
import SwiftData
import Models

/// Ride history across all routes — the novelty factor's raw material,
/// surfaced read-only here (Strava/HealthKit sync writes to this same store
/// in Phase 6).
struct RideLogView: View {
    @Query(sort: \RideLogModel.date, order: .reverse) private var logs: [RideLogModel]
    @Query private var routes: [RouteModel]

    var body: some View {
        List(logs) { log in
            HStack {
                VStack(alignment: .leading) {
                    Text(routeName(for: log))
                        .font(.headline)
                    Text(log.date.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(log.source.rawValue.capitalized)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.secondary.opacity(0.15), in: .capsule)
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

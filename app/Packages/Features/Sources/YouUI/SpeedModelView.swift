import SwiftUI
import SwiftData
import Models
import Services
import SharedUI

/// Per-surface cruising speed + climbing penalty, feeding `SpeedModel`'s ride
/// time estimates (`RouteStats.estimatedRideTime`).
struct SpeedModelView: View {
    @Environment(\.unitSystem) private var unitSystem
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.services) private var services
    @Environment(\.modelContext) private var modelContext
    @Query private var routeModels: [RouteModel]
    @State private var isSyncing = false
    @State private var isStravaConnected = false

    private static let surfaces: [SurfaceType] = [.paved, .busyRoad, .unpaved, .path]

    var body: some View {
        Form {
            Section("Cruising Speed") {
                ForEach(Self.surfaces, id: \.self) { surface in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(label(for: surface))
                            Spacer()
                            Text(UnitFormat.speed(kph: speedBinding(for: surface).wrappedValue, system: unitSystem))
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        Slider(value: speedBinding(for: surface), in: 5...40, step: 1)
                    }
                }
            }
            Section("Climbing") {
                VStack(alignment: .leading, spacing: 4) {
                    // ponytail: "100m" here is the climbing-penalty rate's
                    // fixed distance unit (minutes per 100 vertical meters of
                    // gain), not a display of a stored value — converting it
                    // to "per 330 ft" would need to rescale the penalty
                    // number too, not just relabel it. Left in metric.
                    HStack {
                        Text("Penalty per 100m gain")
                        Spacer()
                        Text("+\(Int(preferencesStore.preferences.climbingPenaltyMinutesPer100m))m")
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                    Slider(value: climbingPenaltyBinding, in: 0...15, step: 0.5)
                }
            }
            if isStravaConnected {
                Section("Strava") {
                    Button(isSyncing ? "Updating…" : "Recompute from Strava Activity") {
                        recomputeFromStrava()
                    }
                    .disabled(isSyncing)
                }
            }
        }
        .navigationTitle("Speed & Climbing")
        .task {
            isStravaConnected = await services.strava.isConnected()
        }
    }

    private func recomputeFromStrava() {
        isSyncing = true
        Task {
            let sync = StravaActivitySyncService(stravaClient: services.strava, modelContext: modelContext)
            if let derived = try? await sync.syncActivities(routes: routeModels, currentSpeeds: preferencesStore.preferences.speedKphBySurface) {
                preferencesStore.preferences.speedKphBySurface = derived
            }
            isSyncing = false
        }
    }

    private func label(for surface: SurfaceType) -> String {
        switch surface {
        case .paved: "Paved"
        case .busyRoad: "Busy Road"
        case .unpaved: "Unpaved"
        case .path: "Path"
        case .unknown: "Unknown"
        }
    }

    private func speedBinding(for surface: SurfaceType) -> Binding<Double> {
        Binding(
            get: { preferencesStore.preferences.speedKphBySurface[surface] ?? 20 },
            set: { preferencesStore.preferences.speedKphBySurface[surface] = $0 }
        )
    }

    private var climbingPenaltyBinding: Binding<Double> {
        Binding(
            get: { preferencesStore.preferences.climbingPenaltyMinutesPer100m },
            set: { preferencesStore.preferences.climbingPenaltyMinutesPer100m = $0 }
        )
    }
}

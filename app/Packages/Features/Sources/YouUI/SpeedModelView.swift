import SwiftUI
import Models
import Services

/// Per-surface cruising speed + climbing penalty, feeding `SpeedModel`'s ride
/// time estimates (`RouteStats.estimatedRideTime`).
struct SpeedModelView: View {
    @Environment(PreferencesStore.self) private var preferencesStore

    private static let surfaces: [SurfaceType] = [.paved, .busyRoad, .unpaved, .path]

    var body: some View {
        Form {
            Section("Cruising Speed") {
                ForEach(Self.surfaces, id: \.self) { surface in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(label(for: surface))
                            Spacer()
                            Text("\(Int(speedBinding(for: surface).wrappedValue)) km/h")
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        Slider(value: speedBinding(for: surface), in: 5...40, step: 1)
                    }
                }
            }
            Section("Climbing") {
                VStack(alignment: .leading, spacing: 4) {
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
        }
        .navigationTitle("Speed & Climbing")
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

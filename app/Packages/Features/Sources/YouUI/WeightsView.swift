import SwiftUI
import Engine
import Services

/// Priorities panel: how much each `RideFactor` counts toward a route's
/// score, feeding `WeightedScorer` directly (DESIGN-SYSTEM.md §9 "priorities
/// panel for engine weights").
struct WeightsView: View {
    @Environment(PreferencesStore.self) private var preferencesStore

    var body: some View {
        Form {
            Section {
                ForEach(RideFactor.allCases, id: \.self) { factor in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(factor.displayName, systemImage: factor.symbolName)
                        Slider(value: weightBinding(for: factor), in: 0...2, step: 0.1)
                    }
                }
            } footer: {
                Text("Higher values make that factor count more toward a route's daily score. 1.0 is neutral.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Priorities")
    }

    private func weightBinding(for factor: RideFactor) -> Binding<Double> {
        Binding(
            get: { preferencesStore.weights[factor] ?? 1.0 },
            set: { preferencesStore.weights[factor] = $0 }
        )
    }
}

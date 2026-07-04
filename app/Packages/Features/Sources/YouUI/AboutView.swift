import SwiftUI
import SharedUI

/// DESIGN-SYSTEM.md §9: "connections (Strava), about, attribution" — the
/// mandatory WeatherKit attribution's second required location (the other is
/// the breakdown sheet footer).
struct AboutView: View {
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Ride On").font(.headline)
                    Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section("Attribution") {
                WeatherAttributionFooter()
            }
        }
        .navigationTitle("About")
    }
}

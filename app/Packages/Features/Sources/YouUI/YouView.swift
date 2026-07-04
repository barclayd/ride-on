import SwiftUI
import SwiftData
import Models
import Services

/// You tab per DESIGN-SYSTEM.md §9: "Sports no-settings philosophy" —
/// preference rows reopen their `DialScreen`, a priorities panel for engine
/// weights, connections (Strava fixture), about + attribution.
public struct YouView: View {
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.services) private var services
    @State private var isStravaConnected = false
    @State private var isConnectingStrava = false

    public init() {}

    public var body: some View {
        @Bindable var preferencesStore = preferencesStore

        List {
            Section("Ride Preferences") {
                NavigationLink("Temperature") {
                    TemperatureRangeEditor(range: $preferencesStore.preferences.preferredTempRangeC)
                }
                NavigationLink("Sun") {
                    SunPreferenceEditor(preference: $preferencesStore.preferences.sunPreference)
                }
                NavigationLink("Rain Tolerance") {
                    RainToleranceEditor(tolerance: $preferencesStore.preferences.rainTolerance)
                }
                NavigationLink("Max Wind") {
                    MaxWindEditor(maxWindKph: $preferencesStore.preferences.maxWindKph)
                }
            }

            Section("Priorities") {
                NavigationLink("Weights") {
                    WeightsView()
                }
                NavigationLink("Speed & Climbing") {
                    SpeedModelView()
                }
            }

            Section("Places") {
                NavigationLink("Saved Places") {
                    SavedPlacesView()
                }
            }

            Section("Activity") {
                NavigationLink("Ride Log") {
                    RideLogView()
                }
            }

            Section("Connections") {
                stravaRow
            }

            Section {
                NavigationLink("About") {
                    AboutView()
                }
            }
        }
        .navigationTitle("You")
    }

    private var stravaRow: some View {
        HStack {
            Label("Strava", systemImage: "figure.outdoor.cycle")
            Spacer()
            if isConnectingStrava {
                ProgressView()
            } else {
                Button(isStravaConnected ? "Connected" : "Connect") {
                    connectStrava()
                }
                .disabled(isStravaConnected)
            }
        }
    }

    private func connectStrava() {
        isConnectingStrava = true
        Task {
            _ = try? await services.strava.exchangeToken(code: "fixture-auth-code")
            isConnectingStrava = false
            isStravaConnected = true
        }
    }
}

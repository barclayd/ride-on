import SwiftUI
import SwiftData
import Models
import Services
import SharedUI

/// You tab per DESIGN-SYSTEM.md §9: "Sports no-settings philosophy" —
/// preference rows reopen their `DialScreen`, a priorities panel for engine
/// weights, connections (Strava fixture), about + attribution.
public struct YouView: View {
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.services) private var services
    @State private var isStravaConnected = false
    @State private var isConnectingStrava = false
    @State private var isHealthPrimingPresented = false

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
                Toggle("Ride Matching", isOn: rideMatchingBinding)
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
        .sheet(isPresented: $isHealthPrimingPresented) {
            PermissionPrimingSheet(
                symbol: "heart.fill",
                title: "Match Your Rides",
                message: "Ride On reads your cycling workouts from Health to automatically log rides against your routes.",
                onAllow: {
                    preferencesStore.hasPrimedHealthPermission = true
                    preferencesStore.isRideMatchingEnabled = true
                },
                onNotNow: { preferencesStore.hasPrimedHealthPermission = true }
            )
        }
    }

    // DESIGN-SYSTEM.md §9: Health is primed right before ride matching is
    // turned on, not upfront in onboarding. Priming UI only — the real
    // `HKHealthStore` authorization request is Phase 6.
    private var rideMatchingBinding: Binding<Bool> {
        Binding(
            get: { preferencesStore.isRideMatchingEnabled },
            set: { newValue in
                if newValue, !preferencesStore.hasPrimedHealthPermission {
                    isHealthPrimingPresented = true
                } else {
                    preferencesStore.isRideMatchingEnabled = newValue
                }
            }
        )
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

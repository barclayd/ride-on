import SwiftUI
import SwiftData
import Models
import Services
import SharedUI

/// You tab per DESIGN-SYSTEM.md §9: "Sports no-settings philosophy" —
/// preference rows reopen their `DialScreen`, a priorities panel for engine
/// weights, connections (Strava), about + attribution.
public struct YouView: View {
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.services) private var services
    @Environment(\.modelContext) private var modelContext
    @State private var isStravaConnected = false
    @State private var isConnectingStrava = false
    @State private var isSyncingRoutes = false
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
        .task {
            isStravaConnected = await services.strava.isConnected()
        }
        .sheet(isPresented: $isHealthPrimingPresented) {
            PermissionPrimingSheet(
                symbol: "heart.fill",
                title: "Match Your Rides",
                message: "Ride On reads your cycling workouts from Health to automatically log rides against your routes.",
                onAllow: {
                    preferencesStore.hasPrimedHealthPermission = true
                    preferencesStore.isRideMatchingEnabled = true
                    #if os(iOS)
                    Task { try? await HealthAuthorization.requestCyclingAuthorization() }
                    #endif
                },
                onNotNow: { preferencesStore.hasPrimedHealthPermission = true }
            )
        }
    }

    // DESIGN-SYSTEM.md §9: Health is primed right before ride matching is
    // turned on, not upfront in onboarding.
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
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                // Strava's brand guideline CTA wording; the connect button
                // still needs their asset/color treatment before shipping —
                // see PLAN.md Phase 8 branding-compliance gate.
                Label("Strava", systemImage: "figure.outdoor.cycle")
                Spacer()
                if isConnectingStrava {
                    ProgressView()
                } else {
                    Button(isStravaConnected ? "Connected" : "Connect with Strava") {
                        connectStrava()
                    }
                    .disabled(isStravaConnected)
                }
            }
            if isStravaConnected {
                Button(isSyncingRoutes ? "Syncing…" : "Sync Routes") {
                    syncRoutes()
                }
                .disabled(isSyncingRoutes)
            }
        }
    }

    private func connectStrava() {
        isConnectingStrava = true
        Task {
            try? await StravaConnect.connect(using: services.strava)
            isStravaConnected = await services.strava.isConnected()
            isConnectingStrava = false
        }
    }

    private func syncRoutes() {
        isSyncingRoutes = true
        Task {
            let importer = RouteImporter(classifyClient: services.classify, modelContext: modelContext)
            let sync = StravaRouteSyncService(stravaClient: services.strava, importer: importer)
            _ = try? await sync.syncRoutes()
            isSyncingRoutes = false
        }
    }
}

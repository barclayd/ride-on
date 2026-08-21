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

        // Grouped Form, not List — one editing surface across the whole tab
        // (Landmarks' editing idiom; REDESIGN.md F). On iOS it renders the
        // same; on Mac it's the difference between a settings pane and a
        // plain table.
        Form {
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
                RidingWindowEditor(windowMinutes: $preferencesStore.preferences.ridingWindowMinutes)
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

            Section("Display") {
                UnitsPicker()
            }

            Section {
                NavigationLink("About") {
                    AboutView()
                }
            }
        }
        .formStyle(.grouped)
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
            let importer = RouteImporter(classifyClient: services.classify, elevationClient: services.elevation, modelContext: modelContext)
            let sync = StravaRouteSyncService(stravaClient: services.strava, importer: importer)
            _ = try? await sync.syncRoutes()
            isSyncingRoutes = false
        }
    }
}

/// Distance/elevation/speed display units — shared between the You tab and
/// the macOS Settings scene (⌘,). Defaults from the locale (UK = metric);
/// picking a value pins it explicitly.
public struct UnitsPicker: View {
    @Environment(PreferencesStore.self) private var preferencesStore

    public init() {}

    public var body: some View {
        Picker("Units", selection: selection) {
            Text("Metric (km, m)").tag(UnitSystem.metric)
            Text("Imperial (mi, ft)").tag(UnitSystem.imperial)
        }
        .sensoryFeedback(.selection, trigger: selection.wrappedValue)
    }

    private var selection: Binding<UnitSystem> {
        Binding(
            get: { preferencesStore.preferences.effectiveUnitSystem },
            set: { preferencesStore.preferences.unitSystem = $0 }
        )
    }
}

/// The rider's preferred riding hours — the bounds the Ride tab's
/// best-window scan searches inside. Two inline wheel-free time pickers;
/// minutes-from-midnight in the model, `Date`s only at the UI edge.
struct RidingWindowEditor: View {
    @Binding var windowMinutes: ClosedRange<Int>?

    var body: some View {
        // ponytail: stock DatePicker(.hourAndMinute) rows, not a custom range
        // control — DESIGN-SYSTEM.md §6's inventory is closed and this is
        // plain settings furniture.
        DatePicker("Earliest start", selection: binding(\.lowerBound), displayedComponents: .hourAndMinute)
        DatePicker("Latest finish", selection: binding(\.upperBound), displayedComponents: .hourAndMinute)
    }

    private var window: ClosedRange<Int> {
        windowMinutes ?? RiderPreferences.defaultRidingWindowMinutes
    }

    private func binding(_ bound: KeyPath<ClosedRange<Int>, Int>) -> Binding<Date> {
        Binding(
            get: {
                Calendar.current.startOfDay(for: .now).addingTimeInterval(Double(window[keyPath: bound]) * 60)
            },
            set: { date in
                let components = Calendar.current.dateComponents([.hour, .minute], from: date)
                let minutes = (components.hour ?? 0) * 60 + (components.minute ?? 0)
                // An inverted pick collapses to a zero-length window at the
                // other bound rather than crashing ClosedRange.
                if bound == \.lowerBound {
                    windowMinutes = min(minutes, window.upperBound)...window.upperBound
                } else {
                    windowMinutes = window.lowerBound...max(minutes, window.lowerBound)
                }
            }
        )
    }
}

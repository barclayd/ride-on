import Networking
import SwiftUI
import AuthenticationServices
import Services
import SharedUI
import Domain

/// Connection and live history; no route import or speed estimate is implied by connecting.
struct StravaConnectionView: View {
    var live = true
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.locale) private var locale
    @State private var status: StravaConnectionAPI.Status?
    @State private var rides: [StravaConnectionAPI.CompletedRide] = []
    @State private var nextPage: Int?
    @State private var busy = false
    @State private var connecting = false
    @State private var message: String?
    @State private var confirmingDisconnect = false
    @State private var generation = UUID()

    var body: some View {
        Form {
            if live && !RideOnAPI.isSignedIn {
                Section { Text("Sign in to Ride On from the Rides tab to connect Strava.") }
            } else if let status {
                Section {
                    LabeledContent("Connection", value: status.connection?.status == .connected ? "Connected" : status.connection == nil ? "Not Connected" : "Reconnect Required")
                    if status.configured {
                        if status.connection?.status != .connected {
                            Button(status.connection == nil ? "Connect with Strava" : "Reconnect with Strava") { Task { await connect() } }
                                .disabled(busy)
                        }
                        if status.connection != nil {
                            Button("Disconnect from Ride On", role: .destructive) { confirmingDisconnect = true }.disabled(busy)
                        }
                    } else {
                        Text("Strava connectivity is being set up. Please try again later.").foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Ride On reads your completed cycling activities. Your connection is shared with Stitch, which also supports activity uploads. Disconnecting here stops Ride On access; Stitch stays connected.")
                }
                if status.connection?.status == .connected {
                    Section {
                        if rides.isEmpty && !busy && message == nil {
                            Text(nextPage == nil ? "No cycling activities found." : "No cycling activities on this page. Load more to look further back.").foregroundStyle(.secondary)
                        }
                        ForEach(rides) { ride in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(ride.name).font(.headline)
                                Text(ride.startedAt, format: .dateTime.day().month(.abbreviated).year())
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text("\(UnitFormat.distance(km: ride.distanceKm, system: unitSystem, locale: locale)) · \(Duration.seconds(ride.movingSeconds).formatted(.time(pattern: .hourMinute))) moving")
                                    .monospacedDigit().font(.subheadline)
                                Text(sportName(ride.sportType)).font(.footnote).foregroundStyle(.secondary)
                                Link("View on Strava", destination: ride.url).font(.footnote)
                            }.padding(.vertical, 4)
                        }
                        if let nextPage {
                            Button("Load More") { Task { await loadHistory(page: nextPage) } }.disabled(busy)
                        }
                    } header: { Text("Completed Rides") }
                    footer: {
                        Text(status.connection?.privateActivities == true
                             ? "Read live from Strava, including Only You activities. Ride history is not saved on this device."
                             : "Read live from Strava. Only You activities are not included with your current permissions.")
                    }
                }
                Section { Link("Manage Shared Access on Strava", destination: URL(string: "https://www.strava.com/settings/apps")!) }
            }
            if busy { Section { ProgressView() } }
            if let message {
                Section {
                    Text(message)
                    if !busy { Button("Reload") { Task { await load() } } }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Strava")
        .toolbarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .onDisappear { clear() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background && !connecting { clear() }
            else if phase == .active && status == nil { Task { await load() } }
        }
        .confirmationDialog("Disconnect Strava from Ride On?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await disconnect() } }
        } message: {
            Text("Your Ride On connection will be removed. Stitch stays connected. You can revoke access to both from Strava’s settings.")
        }
    }

    private func clear() { generation = UUID(); rides = []; nextPage = nil; status = nil; busy = false; message = nil }
    private func load() async {
        guard !busy, !live || RideOnAPI.isSignedIn else { return }
        let current = generation
        busy = true; message = nil; rides = []; nextPage = nil
        do {
            let result = live ? try await StravaConnectionAPI.status() : StravaConnectionAPI.sampleStatus
            guard current == generation else { return }
            status = result
            busy = false
            if result.connection?.status == .connected { await loadHistory(page: 1) }
        } catch {
            guard current == generation else { return }
            busy = false; message = error.localizedDescription
        }
    }
    private func loadHistory(page: Int) async {
        guard !busy else { return }
        let current = generation
        busy = true; message = nil
        do {
            let result = live ? try await StravaConnectionAPI.history(page: page) : StravaConnectionAPI.sampleHistory
            guard current == generation else { return }
            let existing = Set(rides.map(\.id))
            rides += result.rides.filter { !existing.contains($0.id) }
            nextPage = result.nextPage
        } catch {
            guard current == generation else { return }
            if let failure = error as? RideOnAPI.Failure, [401, 403, 409].contains(failure.status) { rides = []; nextPage = nil }
            message = error.localizedDescription
        }
        if current == generation { busy = false }
    }
    private func connect() async {
        guard live, !busy else { return }
        let current = generation
        busy = true; message = nil
        connecting = true
        defer { connecting = false }
        do {
            let flow = try await StravaConnectionAPI.start()
            let callback = try await webAuthenticationSession.authenticate(using: flow.url,
                callback: .https(host: RideOnAPI.host, path: StravaConnectionAPI.donePath),
                preferredBrowserSession: nil, additionalHeaderFields: flow.initialHeaders)
            guard current == generation else { return }
            try await StravaConnectionAPI.finish(callback: callback, flow: flow)
            guard current == generation else { return }
            busy = false
            await load()
        } catch ASWebAuthenticationSessionError.canceledLogin {
            if current == generation { busy = false }
        } catch {
            if current == generation { busy = false; message = error.localizedDescription }
        }
    }
    private func disconnect() async {
        guard !busy else { return }
        let current = generation
        busy = true
        do {
            let confirmation = live ? try await StravaConnectionAPI.disconnect() : "Strava is disconnected from Ride On."
            guard current == generation else { return }
            clear()
            status = .init(configured: true, connection: nil)
            message = confirmation
        } catch {
            if current == generation { busy = false; message = error.localizedDescription }
        }
    }
    private func sportName(_ sport: String) -> String {
        ["Ride": "Ride", "MountainBikeRide": "Mountain bike", "GravelRide": "Gravel ride", "VirtualRide": "Virtual ride",
         "EBikeRide": "E-bike ride", "EMountainBikeRide": "Electric mountain bike", "Handcycle": "Handcycle", "Velomobile": "Velomobile"][sport] ?? sport
    }
}

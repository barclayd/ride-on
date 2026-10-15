import SwiftUI
import UserNotifications
import Models
import Services
import DesignSystem
import SharedUI

/// The Track sheet (docs/redesign/README.md §1, Track sheet), opened by the hero's star: what tracking a ride
/// watches for. Its mode is fixed when it opens. Start Tracking asks for notifications the first
/// time, then hands `true` to `onChange`; Stop Tracking hands `false`. The star changes once the
/// sheet has gone.
struct TrackRideSheet: View {
    var pick: RideBoard.Pick
    var isTracking: Bool
    var onChange: (Bool) -> Void
    @State private var status: UNAuthorizationStatus?
    @State private var height: CGFloat = 640
    @State private var starting = false
    @Environment(RiderSettingsStore.self) private var settings: RiderSettingsStore?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.locale) private var locale
    @Environment(\.speedSystem) private var speedSystem

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                medal.padding(.top, 18)
                Text(isTracking ? "Tracking This Ride" : "Track This Ride")
                    .font(.title2.bold())
                    .padding(.top, 12)
                    .accessibilityAddTraits(.isHeader)
                Text(isTracking
                     ? "Forecast checked 10 minutes ago. Nothing has changed since you started tracking."
                     : "We'll keep checking the forecast and notify you if anything changes before you leave.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.top, 6)
                if isTracking && status == .denied {
                    notificationsOff.padding(.top, 16)
                }
                rideCard.padding(.top, 16)
                triggers.padding(.top, 20)
                actions.padding(.top, 20)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 14)
        }
        .scrollBounceBehavior(.basedOnSize)
        // A height detent leaves out the bottom safe area, so only the top inset is added.
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentSize.height + $0.contentInsets.top } action: { _, new in
            height = new
        }
        .overlay(alignment: .topLeading) {
            Button(role: .close) { dismiss() } label: {
                Label("Close", systemImage: "xmark").labelStyle(.iconOnly)
            }
                .buttonStyle(.glass)
                .tint(.primary)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .padding(16)
        }
        .presentationDetents([.height(height)])
        .presentationDragIndicator(.visible)
        .task(id: scenePhase) {
            // Again on return from Settings, so Turn On's card goes once notifications are on.
            if scenePhase == .active { status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
        }
    }

    /// The star the hero shows, with the bell that says what tracking does.
    private var medal: some View {
        Image(systemName: "star.fill")
            .font(.system(size: 30))
            .foregroundStyle(.white)
            .frame(width: 64, height: 64)
            .background(Color.committed.gradient, in: .circle)
            .shadow(color: .committed.opacity(0.35), radius: 9, y: 6)
            .overlay(alignment: .bottomTrailing) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.committed)
                    .frame(width: 28, height: 28)
                    .background(.groupedBackground, in: .circle)
                    .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
                    .offset(x: 6, y: 4)
            }
            .accessibilityHidden(true)
    }

    private var notificationsOff: some View {
        HStack(spacing: 12) {
            Image(systemName: "bell.slash")
                .font(.title3)
                .foregroundStyle(.belowMinimums)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text("Notifications Are Off").font(.subheadline.weight(.semibold))
                Text("You won't hear if anything changes.").font(.footnote).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            Button("Turn On", action: openNotificationSettings)
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .font(.subheadline.weight(.semibold))
        }
        .padding(.vertical, 12)
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .background(.cardBackground, in: .rect(cornerRadius: 22))
    }

    private var rideCard: some View {
        let day = pick.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        let times = "\(pick.start.formatted(.clockTime)) → ~\(pick.finish.formatted(.clockTime))"
        return HStack(spacing: 12) {
            RouteMap(pick.route.coordinates, style: .thumbnail, tint: pick.meetsMinimums ? .accentColor : .gray)
                .frame(width: 48, height: 48)
                .clipShape(.rect(cornerRadius: 12))
                .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 0) {
                Text(pick.route.name).font(.headline)
                Text("\(day) · \(times)").font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            ScoreGauge(score: pick.score, tint: pick.meetsMinimums ? .accentColor : .gray, size: 40)
        }
        .padding(.vertical, 10)
        .padding(.leading, 10)
        .padding(.trailing, 14)
        .background(.cardBackground, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(pick.route.name), \(pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))), leave \(pick.start.formatted(.clockTime)), back about \(pick.finish.formatted(.clockTime)). Score \(pick.score).")
    }

    // MARK: Triggers

    /// A limit the rider hasn't set has no alert, so its row goes.
    private var triggerRows: [(symbol: String, tint: Color, text: String)] {
        let standards = settings?.settings?.preferences.minimumStandards
        let month = Calendar.current.component(.month, from: pick.start)
        return [
            ("cloud.rain", .rain, "Rain moves in"),
            standards?.maximumGustKph.map { ("wind", .cyan, "Gusts pass your \(UnitFormat.speed(kph: $0, system: speedSystem)) limit") },
            standards?.minimumTemperature?.valueC(in: month).map { ("thermometer.low", .indigo, "It drops below your \(UnitFormat.degrees(c: $0, locale: locale)) minimum") },
            ("clock", .accentColor, "A better time or day opens up"),
        ].compactMap(\.self)
    }

    private var triggers: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(isTracking ? "We'll Notify You If" : "Notify Me If")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(triggerRows, id: \.text) { row in
                    if row.text != triggerRows.first?.text { Divider().padding(.leading, 50) }
                    HStack(spacing: 12) {
                        Image(systemName: row.symbol)
                            .font(.title3)
                            .foregroundStyle(row.tint)
                            .frame(width: 22)
                            .accessibilityHidden(true)
                        Text(row.text).monospacedDigit()
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 46)
                    .padding(.horizontal, 16)
                }
            }
            .background(.cardBackground, in: .rect(cornerRadius: 22))
            Text("Plus the final forecast the evening before.\(status == .notDetermined && !isTracking ? " \(Self.system) will ask to allow notifications." : "")")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
        }
        .multilineTextAlignment(.leading)
    }

    // MARK: Actions

    @ViewBuilder
    private var actions: some View {
        if isTracking {
            Button(role: .destructive) {
                onChange(false)
                dismiss()
            } label: {
                Text("Stop Tracking").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(.red)
        } else {
            VStack(spacing: 4) {
                Button(action: start) {
                    Text("Start Tracking").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .disabled(starting)
                Button("Not Now") { dismiss() }
                    .buttonStyle(.borderless)
                    .controlSize(.large)
                    .frame(minHeight: 44)
            }
        }
    }

    /// Asks for notifications the first time; tracking starts whatever the answer, and the
    /// Tracking sheet shows Notifications Are Off if it was no.
    private func start() {
        starting = true
        Task {
            if status == .notDetermined {
                _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            }
            onChange(true)
            dismiss()
        }
    }

    private func openNotificationSettings() {
        #if os(iOS)
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
        #else
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { openURL(url) }
        #endif
    }

    #if os(iOS)
    private static let system = "iOS"
    #else
    private static let system = "macOS"
    #endif
}

#Preview {
    Text("Rides").sheet(isPresented: .constant(true)) {
        TrackRideSheet(pick: RideBoard.sample.picks[0], isTracking: false) { _ in }
            .environment(RiderSettingsStore(live: false))
    }
}

import SwiftUI
import UserNotifications
import Models
import Services
import DesignSystem
import SharedUI

/// The Track sheet (docs/redesign/README.md §1, Track sheet), opened by the hero's star: what tracking a ride
/// checks for, saved with `RideTracker`. Its mode is fixed when it opens, and the star changes once
/// the sheet has gone. The API doesn't notify yet (`RideTracker.notifies`), so until it does the
/// sheet promises a check each time the rider looks, not an alert.
struct TrackRideSheet: View {
    var pick: RideBoard.Pick
    var isTracking: Bool
    /// The other plan this one replaces, as "Hilly Loop · Thu 17 Oct, 08:00". Fixed when the sheet opens.
    @State private var replacing: String?
    @State private var status: UNAuthorizationStatus?
    @State private var height: CGFloat = 640
    @State private var working = false
    @State private var failure: String?
    /// The plan as last seen, so the sheet doesn't change while Stop Tracking dismisses it.
    @State private var shown: TrackedRide?
    @Environment(RideTracker.self) private var tracker: RideTracker?
    @Environment(RiderSettingsStore.self) private var settings: RiderSettingsStore?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.locale) private var locale
    @Environment(\.speedSystem) private var speedSystem

    init(pick: RideBoard.Pick, isTracking: Bool, replacing: String? = nil) {
        self.pick = pick
        self.isTracking = isTracking
        _replacing = State(initialValue: replacing)
    }

    private var notifies: Bool { tracker?.notifies ?? false }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                medal.padding(.top, 18)
                Text(isTracking ? "Tracking This Ride" : "Track This Ride")
                    .font(.title2.bold())
                    .padding(.top, 12)
                    .accessibilityAddTraits(.isHeader)
                Text(isTracking ? summary
                     : notifies ? "We'll keep checking the forecast and notify you if anything changes before you leave."
                     : "We'll save this forecast and compare it with the latest each time you check back.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.top, 6)
                if isTracking && notifies && status == .denied {
                    notificationsOff.padding(.top, 16)
                }
                if !isTracking, let replacing {
                    replaces(replacing).padding(.top, 16)
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
        .task {
            guard isTracking else { return }
            shown = tracker?.ride
            await tracker?.refreshIfDue()
        }
        .onChange(of: tracker?.ride) { _, ride in
            if isTracking, let ride, ride.pickID == pick.id { shown = ride }
        }
        .alert(isTracking ? "Couldn't Stop Tracking" : "Couldn't Track This Ride", isPresented: .constant(failure != nil)) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
    }

    /// A gold star, with a bell when tracking notifies.
    private var medal: some View {
        Image(systemName: "star.fill")
            .font(.system(size: 30))
            .foregroundStyle(.white)
            .frame(width: 64, height: 64)
            .background(Color.committed.gradient, in: .circle)
            .shadow(color: .committed.opacity(0.35), radius: 9, y: 6)
            .overlay(alignment: .bottomTrailing) {
                if notifies { bell }
            }
            .accessibilityHidden(true)
    }

    private var bell: some View {
        Image(systemName: "bell.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.committed)
            .frame(width: 28, height: 28)
            .background(.groupedBackground, in: .circle)
            .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
            .offset(x: 6, y: 4)
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

    /// Only one ride is tracked at a time, so starting this one stops the other.
    private func replaces(_ ride: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "star.slash")
                .font(.title3)
                .foregroundStyle(.committed)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text("Replaces Your Tracked Ride").font(.subheadline.weight(.semibold))
                Text(ride).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
            }
            .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .background(.cardBackground, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
    }

    private var rideCard: some View {
        let day = pick.start.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        let times = "\(pick.start.formatted(.clockTime)) → ~\(pick.finish.formatted(.clockTime))"
        // Tracking shows the latest check's score; the hero keeps the one it was ranked with.
        let score = isTracking ? shown?.latestScore ?? pick.score : pick.score
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
            ScoreGauge(score: score, tint: pick.meetsMinimums ? .accentColor : .gray, size: 40)
        }
        .padding(.vertical, 10)
        .padding(.leading, 10)
        .padding(.trailing, 14)
        .background(.cardBackground, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(pick.route.name), \(pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))), leave \(pick.start.formatted(.clockTime)), back about \(pick.finish.formatted(.clockTime)). Score \(score).")
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
            Text(!notifies ? "We'll Check If" : isTracking ? "We'll Notify You If" : "Notify Me If")
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
            Text(!notifies ? "Checked each time you open this ride, until you leave."
                 : "Plus the final forecast the evening before.\(status == .notDetermined && !isTracking ? " \(Self.system) will ask to allow notifications." : "")")
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
            Button(role: .destructive, action: stop) {
                label("Stop Tracking")
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(.red)
            .disabled(working)
        } else {
            VStack(spacing: 4) {
                Button(action: start) {
                    label("Start Tracking")
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .disabled(working)
                Button("Not Now") { dismiss() }
                    .buttonStyle(.borderless)
                    .controlSize(.large)
                    .frame(minHeight: 44)
            }
        }
    }

    /// The button's title, or a spinner the same size while the API answers.
    private func label(_ title: String) -> some View {
        Text(title)
            .opacity(working ? 0 : 1)
            .overlay { if working { ProgressView().accessibilityLabel("Saving") } }
            .frame(maxWidth: .infinity)
    }

    /// When the API notifies, asks for notifications the first time; tracking starts whatever the
    /// answer, and the Tracking sheet shows Notifications Are Off if it was no.
    private func start() {
        working = true
        Task {
            if notifies, status == .notDetermined {
                _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            }
            do {
                try await tracker?.track(pick)
                dismiss()
            } catch {
                failure = error.localizedDescription
                working = false
            }
        }
    }

    private func stop() {
        working = true
        Task {
            do {
                try await tracker?.stop()
                dismiss()
            } catch {
                failure = error.localizedDescription
                working = false
            }
        }
    }

    // MARK: Summary

    /// What the latest check found, in sentences. A failed check never says nothing changed.
    private var summary: String {
        switch shown?.check {
        case nil, .due(lastChecked: nil): "The forecast hasn't been checked since you started tracking."
        case .due(let last?): "Forecast last checked \(ago(last))."
        case .checking: "Checking the forecast…"
        case .closed: "It's time to leave, so the forecast isn't checked any more."
        case .failed(let reason, let last):
            [Self.failure(reason), last.map { "Last checked \(ago($0))." }].compactMap(\.self).joined(separator: " ")
        case .checked(let at, let changes):
            (["Forecast checked \(ago(at))."] + (changes.isEmpty ? ["Nothing has changed since you started tracking."] : changes.map(sentence)))
                .joined(separator: " ")
        }
    }

    private static func failure(_ reason: TrackedRide.Reason) -> String {
        switch reason {
        case .routeUnavailable: "Couldn't check the forecast because this route isn't in your library any more."
        case .noLongerFits: "Couldn't check the forecast because this ride no longer fits your window."
        case .forecastUnavailable: "Couldn't check the forecast because it isn't available right now."
        case .missingElevation: "Couldn't check the forecast because this route's elevation is missing."
        case .other: "Couldn't check the forecast."
        }
    }

    private func sentence(_ change: TrackedRide.Change) -> String {
        let speed = { UnitFormat.speed(kph: $0, system: speedSystem) }
        let degrees = { UnitFormat.degrees(c: $0, locale: locale) }
        let percent = { (fraction: Double) in fraction.formatted(.percent.precision(.fractionLength(0))) }
        let rate = { (mmH: Double) in "\(mmH.formatted(.number.precision(.fractionLength(0...1)))) mm/h" }
        switch change {
        case .standard(.gust, let actual, let limit): return "Gusts now reach \(speed(actual)), over your \(speed(limit)) limit."
        case .standard(.cold, let actual, let limit): return "It now drops to \(degrees(actual)), below your \(degrees(limit)) minimum."
        case .standard(.heat, let actual, let limit): return "It now reaches \(degrees(actual)), over your \(degrees(limit)) maximum."
        case .standard(.rainChance, let actual, let limit): return "The chance of rain is now \(percent(actual)), over your \(percent(limit)) limit."
        case .standard(.rainRate, let actual, let limit): return "Rain now reaches \(rate(actual)), over your \(rate(limit)) limit."
        case .rain: return "Rain is now forecast."
        case .betterRoute(let name, let start): return "\(name ?? "Another route")\(when(start)) now looks better."
        case .betterTime(let start): return "Leaving\(when(start)) now looks better."
        case .score(let points):
            let amount = "\(abs(points)) point\(abs(points) == 1 ? "" : "s")"
            return "Its score has \(points < 0 ? "dropped" : "risen") \(amount) since you started tracking."
        case .incomplete: return "Some forecasts were missing, so a better ride might not show."
        }
    }

    /// " at 10:30", or " on Thursday at 10:30" when it's another day.
    private func when(_ start: Date) -> String {
        let day = Calendar.current.isDate(start, inSameDayAs: pick.start) ? "" : " on \(start.formatted(.dateTime.weekday(.wide)))"
        return "\(day) at \(start.formatted(.clockTime))"
    }

    private func ago(_ date: Date) -> String {
        Date.now.timeIntervalSince(date) < 60 ? "just now" : date.formatted(.relative(presentation: .named, unitsStyle: .wide))
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
        TrackRideSheet(pick: RideBoard.sample.picks[0], isTracking: false, replacing: "Ridge Run · Sat 18 Oct, 09:00")
            .environment(RiderSettingsStore(live: false))
            .environment(RideTracker(live: false))
    }
}

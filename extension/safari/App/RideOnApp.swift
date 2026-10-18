import SwiftUI

@main
struct RideOnApp: App {
  #if os(iOS)
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var delegate
  #else
    @NSApplicationDelegateAdaptor(NotificationAppDelegate.self) private var delegate
  #endif
  var body: some Scene {
    #if os(iOS)
      WindowGroup { EnableGuide() }
    #else
      Window("Ride On", id: "settings") { SettingsWindow() }
        .defaultSize(width: 720, height: 470)
        .windowResizability(.contentMinSize)
    #endif
  }
}

#if os(iOS)
  /// Safari extensions ship inside an app; this one explains how to turn Ride On on.
  struct EnableGuide: View {
    @State private var notifications = PushNotifications.shared
    @Environment(\.scenePhase) private var scenePhase
    private let steps: [LocalizedStringKey] = [
      "Open **Settings → Apps → Safari → Extensions**, choose **Ride On** and turn on **Allow Extension**.",
      "In Safari, tap the extensions button in the address bar, choose **Ride On** and sign in with Google or Apple. Allow it on **cycle.travel** and **api.ride-on.cc** when asked.",
      "Track routes on your cycle.travel journeys page. Ride On picks the best one, and the best time to ride it.",
    ]

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          VStack(alignment: .leading, spacing: 8) {
            Text("Ride On for Safari").font(.largeTitle.bold())
            Text("Pick the best of your saved cycle.travel routes, and the best time to ride it.")
              .foregroundStyle(.secondary)
          }
          VStack(alignment: .leading, spacing: 16) {
            ForEach(steps.indices, id: \.self) { index in
              Label {
                Text(steps[index])
              } icon: {
                Image(systemName: "\(index + 1).circle.fill").foregroundStyle(.tint)
              }
            }
          }
          Divider()
          VStack(alignment: .leading, spacing: 12) {
            Text("Ride notifications").font(.headline)
            Text(notifications.message).foregroundStyle(.secondary)
            Button(notifications.ready ? "Turn off on this device" : "Enable notifications") {
              Task {
                if notifications.ready {
                  await notifications.disable()
                } else {
                  await notifications.enable()
                }
              }
            }
            .buttonStyle(.borderedProminent)
            .disabled(notifications.busy)
            if notifications.optedIn && !notifications.ready {
              Button("Turn off on this device") { Task { await notifications.disable() } }
                .disabled(notifications.busy)
            }
            Text("Notification taps open your tracked ride in the browser.").font(.footnote)
              .foregroundStyle(.secondary)
          }
          Link("Open cycle.travel", destination: URL(string: "https://cycle.travel/user/journeys")!)
        }
        .padding(32)
        .frame(maxWidth: 560, alignment: .leading)
      }
      // rideon-notifications:// links.
      .onOpenURL { url in
        if url.scheme == "rideon-notifications" { Task { await notifications.refresh() } }
      }
      .task(id: scenePhase) { if scenePhase == .active { await notifications.refresh() } }
    }
  }
#endif

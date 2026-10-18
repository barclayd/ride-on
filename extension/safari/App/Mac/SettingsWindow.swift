#if os(macOS)
  import SwiftUI

  enum Pane: String, CaseIterable, Identifiable {
    case general, notifications, help
    var id: Self { self }
    var title: String {
      switch self {
      case .general: "General"
      case .notifications: "Notifications"
      case .help: "Help"
      }
    }
    var symbol: String {
      switch self {
      case .general: "gearshape.fill"
      case .notifications: "bell.badge.fill"
      case .help: "questionmark"
      }
    }
    var tint: Color {
      switch self {
      case .general: .gray
      case .notifications: .red
      case .help: .blue
      }
    }
  }

  /// The Mac app's only window, laid out like System Settings: the extension and account under
  /// General, this Mac's alert switches under Notifications, and the setup steps under Help.
  struct SettingsWindow: View {
    @State private var setup = MacSetup()
    @AppStorage("pane") private var pane = Pane.general

    var body: some View {
      NavigationSplitView {
        Sidebar(setup: setup, pane: $pane)
          .navigationSplitViewColumnWidth(200)
          .toolbar(removing: .sidebarToggle)
      } detail: {
        Group {
          switch pane {
          case .general: GeneralPane(setup: setup)
          case .notifications: NotificationsPane(setup: setup)
          case .help: HelpPane()
          }
        }
        .navigationTitle(pane.title)
      }
      .frame(minWidth: 640, minHeight: 420)
      .task { await setup.refresh() }
      .onReceive(
        NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)
      ) { _ in Task { await setup.refresh() } }
      // The extension's Enable notifications opens rideon-notifications://enable.
      .onOpenURL { url in
        guard url.scheme == "rideon-notifications" else { return }
        pane = .notifications
        if url.host == "enable" { Task { await setup.enable() } }
      }
    }
  }

  private struct Sidebar: View {
    let setup: MacSetup
    @Binding var pane: Pane

    var body: some View {
      List(selection: Binding<Pane?>(get: { pane }, set: { if let new = $0 { pane = new } })) {
        HStack(spacing: 9) {
          Image(nsImage: NSApp.applicationIconImage)
            .resizable()
            .frame(width: 32, height: 32)
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 1) {
            Text("Ride On").font(.system(size: 13, weight: .semibold))
            Text(setup.accountLine)
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .truncationMode(.middle)
          }
        }
        .padding(.vertical, 6)
        .selectionDisabled()
        ForEach(Pane.allCases) { pane in
          Label {
            HStack {
              // Never truncated: the fixed 200pt column leaves room for it at every sidebar icon size.
              Text(pane.title).fixedSize()
              Spacer(minLength: 4)
              if needsAttention(pane) {
                Circle()
                  .fill(.orange)
                  .frame(width: 8, height: 8)
                  .accessibilityLabel("Needs attention")
              }
            }
          } icon: {
            Image(systemName: pane.symbol)
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(.white)
              .frame(width: 20, height: 20)
              .background(pane.tint.gradient, in: .rect(cornerRadius: 5))
          }
          .tag(pane)
        }
      }
      .listStyle(.sidebar)
    }

    private func needsAttention(_ pane: Pane) -> Bool {
      switch pane {
      case .general: setup.extensionOn == false || setup.account == nil
      case .notifications: !setup.granted
      case .help: false
      }
    }
  }

  private struct GeneralPane: View {
    let setup: MacSetup

    var body: some View {
      Form {
        Section {
          extensionRow
          accountRow
        } footer: {
          Text(
            "Ride On runs in Safari. Allow it on cycle.travel and api.ride-on.cc when Safari asks."
          )
        }
      }
      .formStyle(.grouped)
    }

    @ViewBuilder private var extensionRow: some View {
      switch setup.extensionOn {
      case true?:
        StatusRow(title: "Safari extension", detail: "On", dot: .green) {
          Button("Safari Settings…", action: setup.openSafariSettings)
        }
      case false?:
        StatusRow(
          title: "Safari extension", detail: "Off. Turn it on in Safari Settings → Extensions.",
          dot: .orange
        ) {
          Button("Open Safari Settings…", action: setup.openSafariSettings)
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
        }
      case nil:
        StatusRow(title: "Safari extension", detail: "Checking…", dot: .gray) {
          Button("Open Safari Settings…", action: setup.openSafariSettings).disabled(true)
        }
      }
    }

    @ViewBuilder private var accountRow: some View {
      let signedOut = "Not signed in. Sign in from Ride On in Safari’s toolbar."
      if let account = setup.account {
        StatusRow(
          title: "Account",
          detail: account.email.map { "Signed in as \($0)" } ?? "Signed in", dot: .green
        ) {
          Button("Sign Out") { Task { await setup.signOut() } }
            .disabled(setup.busy)
        }
      } else if setup.extensionOn == true {
        StatusRow(title: "Account", detail: signedOut, dot: .orange) {
          Button("Open Safari", action: setup.openSafari)
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
        }
      } else {
        StatusRow(title: "Account", detail: signedOut, dot: .gray) {
          Button("Open Safari", action: setup.openSafari).disabled(true)
        }
      }
    }
  }

  /// A title, a status line led by a coloured dot, and the one button for the next step.
  private struct StatusRow<Action: View>: View {
    let title: String
    let detail: String
    let dot: Color
    @ViewBuilder let action: Action

    var body: some View {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.system(size: 13, weight: .medium))
          HStack(spacing: 6) {
            Circle().fill(dot).frame(width: 7, height: 7).accessibilityHidden(true)
            Text(detail)
          }
          .font(.system(size: 11))
          .foregroundStyle(.secondary)
        }
        Spacer()
        action
      }
      .accessibilityElement(children: .combine)
    }
  }

  private struct NotificationsPane: View {
    let setup: MacSetup
    @State private var notifications = PushNotifications.shared

    var body: some View {
      Form {
        Section {
          toggle(
            "Ride alerts", detail: "When the forecast for your tracked ride changes", \.rideAlerts)
          toggle("Final forecast", detail: "18:00 the evening before your ride", \.finalForecast)
          toggle("Sound", detail: "Play a sound with each alert", \.sound)
        } footer: {
          footer
        }
      }
      .formStyle(.grouped)
    }

    private func toggle(
      _ title: String, detail: String, _ key: WritableKeyPath<PushStore.Alerts, Bool>
    ) -> some View {
      Toggle(
        isOn: Binding(
          get: { setup.granted && setup.alerts[keyPath: key] },
          set: { setup.set(key, to: $0) })
      ) {
        Text(title)
        Text(detail)
      }
      .toggleStyle(.switch)
      .opacity(setup.permission == .notDetermined ? 0.45 : 1)
      .disabled(setup.permission == .denied)
    }

    @ViewBuilder private var footer: some View {
      switch setup.permission {
      case .denied:
        VStack(alignment: .leading, spacing: 8) {
          Text("Notifications are turned off for Ride On in System Settings.")
          Button("Open Notification Settings…", action: setup.openNotificationSettings)
        }
      case .notDetermined:
        Text("Turn on any switch and macOS will ask you to allow notifications from Ride On.")
      default:
        VStack(alignment: .leading, spacing: 4) {
          Text("Clicking a notification opens your tracked ride in Safari.")
          if let failure = notifications.failure {
            Text(failure).foregroundStyle(.red)
          }
        }
      }
    }
  }

  private struct HelpPane: View {
    private let steps = [
      "Open Safari Settings → Extensions and tick Ride On.",
      "Click Ride On in Safari’s toolbar and sign in with Google or Apple. Allow it on cycle.travel and api.ride-on.cc when Safari asks.",
      "Track routes on your cycle.travel journeys page. Ride On picks the best one, and the best time to ride it.",
    ]

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          ForEach(steps.indices, id: \.self) { index in
            HStack(alignment: .firstTextBaseline, spacing: 12) {
              Text("\(index + 1)")
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 22, height: 22)
                .background(.quinary, in: .circle)
                .overlay(Circle().strokeBorder(.separator, lineWidth: 0.5))
                .accessibilityLabel("Step \(index + 1)")
              Text(steps[index])
                .font(.system(size: 13))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
      }
    }
  }

  #Preview { SettingsWindow().frame(width: 720, height: 470) }
#endif

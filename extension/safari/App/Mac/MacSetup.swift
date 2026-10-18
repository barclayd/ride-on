#if os(macOS)
  import AppKit
  import SafariServices
  import UserNotifications

  /// What the Mac window shows: whether Safari runs the extension, the account the extension
  /// shares on sign-in, and this Mac's notification switches.
  @MainActor @Observable
  final class MacSetup {
    static let extensionID = "com.danbarclay.rideon.Extension"
    static let journeys = URL(string: "https://cycle.travel/user/journeys")!

    /// nil until Safari answers.
    private(set) var extensionOn: Bool?
    private(set) var account: PushStore.Link?
    private(set) var permission = UNAuthorizationStatus.notDetermined
    private(set) var alerts = PushStore.Alerts()
    private(set) var busy = false
    private var refreshing = false

    var granted: Bool { permission == .authorized || permission == .provisional }
    var accountLine: String {
      account.map { $0.email ?? "Signed in" } ?? "Not signed in"
    }

    /// Runs when the window opens and whenever the app comes back, e.g. from Safari Settings.
    func refresh() async {
      guard !refreshing else { return }
      refreshing = true
      defer { refreshing = false }
      // An extension Safari has never seen throws; treat it as off.
      extensionOn =
        (try? await SFSafariExtensionManager.stateOfSafariExtension(
          withIdentifier: Self.extensionID
        ).isEnabled) ?? false
      account = try? PushStore.read("link")
      alerts = (try? PushStore.read("alerts")) ?? PushStore.Alerts()
      permission = await UNUserNotificationCenter.current().notificationSettings()
        .authorizationStatus
      await sync()
    }

    func openSafariSettings() {
      Task { try? await SFSafariApplication.showPreferencesForExtension(withIdentifier: Self.extensionID) }
    }

    func openSafari() { openInSafari(Self.journeys) }

    func openNotificationSettings() {
      let id = Bundle.main.bundleIdentifier ?? "com.danbarclay.rideon"
      NSWorkspace.shared.open(
        URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)")!)
    }

    /// Before macOS has asked, any switch asks. After a denial only System Settings can change it.
    func set(_ key: WritableKeyPath<PushStore.Alerts, Bool>, to on: Bool) {
      guard granted else {
        Task { await allow() }
        return
      }
      alerts[keyPath: key] = on
      let alerts = alerts
      Task {
        do {
          try PushStore.write("alerts", alerts)
          await sync()
          if alerts.any { try await PushStore.update(alerts) }
        } catch {
          PushNotifications.shared.failure = Self.message(error)
        }
      }
    }

    /// The extension's Enable notifications: macOS asks if it hasn't yet, then this Mac registers
    /// for the switches that are on (the extension turned them on if none were).
    func enable() async {
      account = try? PushStore.read("link")
      alerts = (try? PushStore.read("alerts")) ?? PushStore.Alerts()
      permission = await UNUserNotificationCenter.current().notificationSettings()
        .authorizationStatus
      if permission == .notDetermined { await allow() } else { await sync() }
    }

    private func allow() async {
      guard permission == .notDetermined else { return }
      _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [
        .alert, .sound,
      ])
      permission = await UNUserNotificationCenter.current().notificationSettings()
        .authorizationStatus
      await sync()
    }

    /// Registers this Mac while it should get alerts, and removes it when it shouldn't.
    private func sync() async {
      guard var link = account else { return }
      do {
        if granted && alerts.any {
          if !link.enabled {
            link.enabled = true
            try PushStore.write("link", link)
            account = link
          }
          // The token arrives in NotificationAppDelegate, which registers it with the API.
          PushNotifications.shared.registerWithApple()
        } else if link.enabled {
          try await PushStore.unregister()
          NSApplication.shared.unregisterForRemoteNotifications()
          account = try PushStore.read("link")
        }
      } catch {
        PushNotifications.shared.failure = Self.message(error)
      }
    }

    /// Signs out everywhere: this Mac stops getting alerts, the session ends, and the extension
    /// signs out too: at once if it's running, otherwise on its next check-in or API call.
    func signOut() async {
      guard let link = account else { return }
      busy = true
      defer { busy = false }
      // Remove this Mac from alerts while the session still works.
      try? await PushStore.unregister()
      NSApplication.shared.unregisterForRemoteNotifications()
      struct Empty: Encodable, Sendable {}
      _ = try? await PushStore.request("api/auth/sign-out", method: "POST", link: link, body: Empty())
      try? PushStore.remove("link")
      try? PushStore.write("sign-out", PushStore.SignOut(owner: link.owner, token: link.token))
      try? await SFSafariApplication.dispatchMessage(
        withName: "signOut", toExtensionWithIdentifier: Self.extensionID,
        userInfo: ["owner": link.owner])
      account = nil
      PushNotifications.shared.failure = nil
    }

    private static func message(_ error: Error) -> String {
      (error as? PushStore.Failure)?.message ?? "Could not update notifications. Try again."
    }
  }
#endif

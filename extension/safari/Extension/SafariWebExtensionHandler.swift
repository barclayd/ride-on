import SafariServices
import UserNotifications

#if os(macOS)
  import AppKit
#endif

/// The extension checks in with `{type: "account", owner, token, email, apiURL}` while signed in,
/// and with `{type: "account"}` once signed out. The app shows the account and owns notifications.
/// Preferences' Enable notifications adds `notifications: "on"`, and Turn off adds `"off"`.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  // NSExtensionContext lives for this one async response and is never mutated elsewhere.
  private struct Reply: @unchecked Sendable { let context: NSExtensionContext }
  func beginRequest(with context: NSExtensionContext) {
    guard let item = context.inputItems.first as? NSExtensionItem,
      let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any],
      message["type"] as? String == "account"
    else {
      context.completeRequest(returningItems: nil)
      return
    }
    let owner = message["owner"] as? String
    let token = message["token"] as? String
    let email = (message["email"] as? String).flatMap { $0.count <= 320 ? $0 : nil }
    let apiURL = message["apiURL"] as? String
    let notifications = message["notifications"] as? String
    let reply = Reply(context: context)
    Task { @MainActor in
      let result: [String: Any]
      do {
        if let owner, let token, !owner.isEmpty, owner.count <= 256, !token.isEmpty,
          token.count <= 8192
        {
          result = try await Self.signedIn(
            owner: owner, token: token, email: email, apiURL: apiURL, notifications: notifications)
        } else {
          // Signed out in Safari: stop alerts and forget the account.
          try? PushStore.remove("sign-out")
          try? await PushStore.unlink()
          result = [
            "status": "off", "enabled": false, "message": "Notifications are off on this device.",
          ]
        }
      } catch {
        result = [
          "error": (error as? PushStore.Failure)?.message
            ?? "Could not check notifications. Open Ride On and try again."
        ]
      }
      let response = NSExtensionItem()
      response.userInfo = [SFExtensionMessageKey: result]
      reply.context.completeRequest(returningItems: [response])
    }
  }

  @MainActor
  private static func signedIn(
    owner: String, token: String, email: String?, apiURL: String?, notifications: String?
  ) async throws -> [String: Any] {
    guard apiURL == PushStore.api.absoluteString else {
      return [
        "status": "off", "enabled": false,
        "message": "Apple notifications need the production Ride On extension.",
      ]
    }
    if let request: PushStore.SignOut = try PushStore.read("sign-out") {
      try PushStore.remove("sign-out")
      // Only the session the app signed out; a fresh sign-in since then stays.
      if request.owner == owner && request.token == token { return ["signOut": true] }
    }
    let previous: PushStore.Link? = try PushStore.read("link")
    if let previous, previous.owner != owner, previous.enabled {
      throw PushStore.Failure(
        "Ride On on this device is set up for another account. Sign out of it in the Ride On app first."
      )
    }
    var link = PushStore.Link(owner: owner, token: token, email: email)
    link.enabled = previous?.owner == owner && previous?.enabled == true
    try PushStore.write("link", link)
    switch notifications {
    case "on": try turnOn()
    case "off": try await turnOff()
    default: break
    }
    var status: [String: Any] = try await PushStore.status()
    status["enabled"] = (try PushStore.read("link", as: PushStore.Link.self))?.enabled == true
    if notifications == "on", status["status"] as? String == "off" {
      let settings = await UNUserNotificationCenter.current().notificationSettings()
      status["message"] =
        settings.authorizationStatus == .notDetermined
        ? "Allow notifications when Ride On asks." : "Finishing setup in the Ride On app…"
    }
    return status
  }

  /// Only the app can ask macOS and register with Apple, so this opens it (`rideon-notifications://enable`)
  /// with at least one Mac switch on. An app extension on iOS can't open its app.
  @MainActor
  private static func turnOn() throws {
    #if os(macOS)
      var alerts: PushStore.Alerts = try PushStore.read("alerts") ?? PushStore.Alerts()
      if !alerts.any {
        alerts.rideAlerts = true
        alerts.finalForecast = true
        try PushStore.write("alerts", alerts)
      }
      guard NSWorkspace.shared.open(URL(string: "rideon-notifications://enable")!) else {
        throw PushStore.Failure("Open the Ride On app to turn on notifications.")
      }
    #else
      throw PushStore.Failure("Open the Ride On app and tap Enable notifications.")
    #endif
  }

  /// Stops this device's alerts and keeps the account. On the Mac the switches go off too, so the
  /// app doesn't turn them back on when it next opens.
  private static func turnOff() async throws {
    #if os(macOS)
      var alerts: PushStore.Alerts = try PushStore.read("alerts") ?? PushStore.Alerts()
      alerts.rideAlerts = false
      alerts.finalForecast = false
      try PushStore.write("alerts", alerts)
    #endif
    try await PushStore.unregister()
  }
}

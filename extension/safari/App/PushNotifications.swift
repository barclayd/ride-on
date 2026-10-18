import SwiftUI
import UserNotifications

#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

@MainActor @Observable
final class PushNotifications {
  static let shared = PushNotifications()
  var message = "Sign in to Ride On in Safari, then turn on notifications here."
  var ready = false
  var optedIn = false
  var busy = false
  /// The last registration failure, shown under the Mac app's switches.
  var failure: String?
  func refresh() async {
    do {
      if let link: PushStore.Link = try PushStore.read("link"), link.enabled {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        if settings.authorizationStatus == .authorized
          || settings.authorizationStatus == .provisional
        {
          registerWithApple()
        } else if settings.authorizationStatus == .denied {
          try await PushStore.unregister()
        }
      }
      optedIn = (try PushStore.read("link", as: PushStore.Link.self))?.enabled == true
      let status = try await PushStore.status()
      message = status["message"] ?? message
      ready = status["status"] == "ready"
    } catch {
      message =
        (error as? PushStore.Failure)?.message ?? "Could not check notifications. Please try again."
    }
  }
  func enable() async {
    busy = true
    defer { busy = false }
    do {
      guard var link: PushStore.Link = try PushStore.read("link") else {
        throw PushStore.Failure("Sign in to Ride On in Safari first.")
      }
      let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [
        .alert, .sound, .badge,
      ])
      guard allowed else {
        throw PushStore.Failure("Allow Ride On notifications in system settings, then try again.")
      }
      link.enabled = true
      optedIn = true
      try PushStore.write("link", link)
      message = "Connecting notification delivery…"
      registerWithApple()
    } catch {
      message =
        (error as? PushStore.Failure)?.message
        ?? "Could not enable notifications. Please try again."
    }
  }
  func disable() async {
    busy = true
    defer { busy = false }
    do {
      try await PushStore.unregister()
      #if os(iOS)
        UIApplication.shared.unregisterForRemoteNotifications()
      #else
        NSApplication.shared.unregisterForRemoteNotifications()
      #endif
      ready = false
      optedIn = false
      message = "Notifications are off on this device."
    } catch {
      ready = false
      message =
        (error as? PushStore.Failure)?.message
        ?? "Delivery is disabled locally. Reconnect to finish removing this device."
    }
  }
  func registerWithApple() {
    #if os(iOS)
      UIApplication.shared.registerForRemoteNotifications()
    #else
      NSApplication.shared.registerForRemoteNotifications()
    #endif
  }
  func received(_ data: Data) async {
    do {
      let token = data.map { String(format: "%02x", $0) }.joined()
      try await PushStore.register(deviceToken: token)
      failure = nil
      optedIn = (try PushStore.read("link", as: PushStore.Link.self))?.enabled == true
      let status = try await PushStore.status()
      message = status["message"] ?? message
      ready = status["status"] == "ready"
    } catch {
      message =
        (error as? PushStore.Failure)?.message
        ?? "Could not connect notification delivery. Enable notifications in Safari again."
      failure = message
    }
  }
  func openRide(_ id: String?) {
    guard let id, UUID(uuidString: id) != nil,
      let url = URL(string: "https://api.ride-on.cc/notifications/open#ride=\(id)")
    else { return }
    #if os(iOS)
      UIApplication.shared.open(url)
    #else
      openInSafari(url)
    #endif
  }
}

#if os(iOS)
  typealias PlatformAppDelegate = UIApplicationDelegate
#else
  typealias PlatformAppDelegate = NSApplicationDelegate
#endif
@MainActor
final class NotificationAppDelegate: NSObject, PlatformAppDelegate, UNUserNotificationCenterDelegate
{
  #if os(iOS)
    func application(
      _ application: UIApplication,
      didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
      UNUserNotificationCenter.current().delegate = self
      return true
    }
    func application(
      _ application: UIApplication,
      didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) { Task { await PushNotifications.shared.received(deviceToken) } }
    func application(
      _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
      PushNotifications.shared.message = "Apple notification registration failed. Please try again."
    }
  #else
    func applicationDidFinishLaunching(_ notification: Notification) {
      UNUserNotificationCenter.current().delegate = self
    }
    func application(
      _ application: NSApplication,
      didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) { Task { await PushNotifications.shared.received(deviceToken) } }
    func application(
      _ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
      PushNotifications.shared.message = "Apple notification registration failed. Please try again."
      PushNotifications.shared.failure = PushNotifications.shared.message
    }
    // Like Apple's Safari extension template: closing the window quits.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  #endif
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let id = response.notification.request.content.userInfo["trackedRideId"] as? String
    await MainActor.run { PushNotifications.shared.openRide(id) }
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let enabled = (try? PushStore.read("link", as: PushStore.Link.self))?.enabled == true
    #if os(macOS)
      let sound = (try? PushStore.read("alerts", as: PushStore.Alerts.self))?.sound == true
    #else
      let sound = true
    #endif
    completionHandler(enabled ? sound ? [.banner, .sound, .list] : [.banner, .list] : [])
  }
}

#if os(macOS)
  /// Ride On runs in Safari, so its links open there even when another browser is the default.
  @MainActor func openInSafari(_ url: URL) {
    if let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") {
      NSWorkspace.shared.open(
        [url], withApplicationAt: safari, configuration: NSWorkspace.OpenConfiguration())
    } else {
      NSWorkspace.shared.open(url)
    }
  }
#endif

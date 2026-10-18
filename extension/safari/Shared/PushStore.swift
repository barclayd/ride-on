import Foundation
import Security
import UserNotifications

/// Shared only by the signed companion app and its Safari extension. Never use shared defaults for sessions.
enum PushStore {
  /// The extension's signed-in account, shared on sign-in so the app can show it and sign out.
  /// `enabled` means this device should be registered for ride alerts.
  struct Link: Codable, Sendable {
    var owner: String
    var token: String
    var enabled = false
    var email: String?
  }
  /// The Mac app's notification switches. They belong to this device, not the account.
  struct Alerts: Codable, Equatable, Sendable {
    var rideAlerts = true
    var finalForecast = true
    var sound = false
    var any: Bool { rideAlerts || finalForecast }
  }
  /// Left by the app's Sign Out for the extension, which signs out when it next checks in.
  struct SignOut: Codable, Sendable {
    var owner: String
    var token: String
  }
  struct Receipt: Codable, Sendable {
    var owner: String
    var deviceToken: String
    var configured: Bool
    var environment: String
  }
  static let api = URL(string: "https://api.ride-on.cc")!
  static let service = "com.danbarclay.rideon.notifications"
  static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.timeoutIntervalForRequest = 15
    return URLSession(configuration: configuration)
  }()
  static func query(_ key: String) throws -> [String: Any] {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "RideOnKeychainGroup") as? String,
      !group.contains("$(")
    else { throw Failure("Notification sharing is not configured in this build.") }
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: key, kSecAttrAccessGroup as String: group,
    ]
    #if os(macOS)
      query[kSecUseDataProtectionKeychain as String] = true
    #endif
    return query
  }
  static func read<T: Decodable>(_ key: String, as: T.Type = T.self) throws -> T? {
    var request = try query(key)
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw Failure("Unlock your device and try again.")
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
  static func write<T: Encodable>(_ key: String, _ value: T) throws {
    let request = try query(key)
    let data = try JSONEncoder().encode(value)
    let update = [kSecValueData as String: data]
    var status = SecItemUpdate(request as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var insert = request
      insert[kSecValueData as String] = data
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      status = SecItemAdd(insert as CFDictionary, nil)
    }
    guard status == errSecSuccess else {
      throw Failure("Could not save notification setup. Try again after unlocking your device.")
    }
  }
  static func remove(_ key: String) throws {
    let status = SecItemDelete(try query(key) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw Failure("Could not clear notification setup.")
    }
  }
  static func installationID() throws -> String {
    if let id: String = try read("installation") { return id }
    let id = UUID().uuidString.lowercased()
    try write("installation", id)
    return id
  }
  struct Failure: LocalizedError, Sendable {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
  }
  static func request(
    _ path: String, method: String, link: Link, body: (any Encodable & Sendable)? = nil
  ) async throws -> Data
  {
    var request = URLRequest(url: api.appendingPathComponent(path))
    request.httpMethod = method
    request.setValue("Bearer \(link.token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONEncoder().encode(body)
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      if (response as? HTTPURLResponse)?.statusCode == 401 {
        throw Failure("Sign in to the Safari extension again, then check notification setup.")
      }
      throw Failure("Could not connect notification delivery. Try again shortly.")
    }
    if let refreshed = http.value(forHTTPHeaderField: "set-auth-token"),
      var current: Link = try read("link"), current.owner == link.owner, current.token == link.token
    {
      current.token = refreshed
      try write("link", current)
    }
    return data
  }
  static func register(deviceToken: String) async throws {
    guard let link: Link = try read("link"), link.enabled else { return }
    #if os(iOS)
      let platform = "ios"
    #else
      let platform = "macos"
    #endif
    guard
      let environment = Bundle.main.object(forInfoDictionaryKey: "RideOnPushEnvironment")
        as? String,
      ["sandbox", "production"].contains(environment)
    else { throw Failure("Push delivery is not configured in this build.") }
    struct Body: Encodable, Sendable {
      var token, environment, topic, platform, scope: String
      var alerts: Alerts?
    }
    let id = try installationID()
    // The API rejects unknown fields, so the switches go only once it says it can apply them.
    // Only the Mac has switches; iOS keeps the API's all-on default, sound included.
    #if os(macOS)
      let alerts: Alerts? = try await deviceAlerts(link) ? read("alerts") ?? Alerts() : nil
    #else
      let alerts: Alerts? = nil
    #endif
    let data = try await request(
      "push-devices/\(id)", method: "PUT", link: link,
      body: Body(
        token: deviceToken, environment: environment, topic: "com.danbarclay.rideon",
        platform: platform, scope: "tracked_rides", alerts: alerts))
    struct Registration: Decodable { var deliveryConfigured: Bool }
    let result = try JSONDecoder().decode(Registration.self, from: data)
    let current: Link? = try read("link")
    // If disable/sign-out raced the PUT, compensate after the registration finishes.
    guard current?.owner == link.owner, current?.enabled == true else {
      _ = try await request("push-devices/\(id)", method: "DELETE", link: link)
      return
    }
    try write(
      "receipt",
      Receipt(
        owner: link.owner, deviceToken: deviceToken, configured: result.deliveryConfigured,
        environment: environment))
  }
  /// API 0.39 (docs/extension-api-brief-v12.md) applies the switches for each device.
  static func deviceAlerts(_ link: Link) async throws -> Bool {
    struct Configuration: Decodable { var deviceAlerts: Bool? }
    let data = try await request("push-devices/config", method: "GET", link: link)
    return try JSONDecoder().decode(Configuration.self, from: data).deviceAlerts == true
  }
  /// Sends changed switches to a registered device. Before API 0.39 they stay on this device.
  static func update(_ alerts: Alerts) async throws {
    guard let link: Link = try read("link"), link.enabled,
      let receipt: Receipt = try read("receipt"), receipt.owner == link.owner,
      try await deviceAlerts(link)
    else { return }
    struct Body: Encodable, Sendable { var alerts: Alerts }
    _ = try await request(
      "push-devices/\(installationID())", method: "PATCH", link: link, body: Body(alerts: alerts))
  }
  /// Stops alerts to this device. The account stays shared.
  static func unregister() async throws {
    guard var link: Link = try read("link") else { return }
    link.enabled = false
    try write("link", link)
    try remove("receipt")
    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    _ = try await request("push-devices/\(installationID())", method: "DELETE", link: link)
  }
  /// Signing out: stops alerts and forgets the account, even when the API can't be reached.
  static func unlink() async throws {
    defer { try? remove("link") }
    try await unregister()
  }
  static func status() async throws -> [String: String] {
    let id = try installationID()
    guard let link: Link = try read("link") else {
      return [
        "installationId": id, "status": "off",
        "message": "Sign in to Ride On in Safari first.",
      ]
    }
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    if settings.authorizationStatus == .denied {
      return [
        "installationId": id, "status": "blocked",
        "message": "Allow Ride On notifications in system settings.",
      ]
    }
    if !link.enabled {
      return [
        "installationId": id, "status": "off",
        "message": "Notifications are off on this device.",
      ]
    }
    let receipt: Receipt? = try read("receipt")
    if link.enabled && receipt?.owner == link.owner && receipt?.configured == true
      && (settings.authorizationStatus == .authorized
        || settings.authorizationStatus == .provisional)
    {
      struct Configuration: Decodable {
        var automaticChecks: Bool
        var apns: [String: Bool]
      }
      struct Devices: Decodable {
        struct Device: Decodable { var id: String }
        var devices: [Device]
      }
      let configuration = try JSONDecoder().decode(
        Configuration.self, from: await request("push-devices/config", method: "GET", link: link))
      let devices = try JSONDecoder().decode(
        Devices.self, from: await request("push-devices", method: "GET", link: link))
      guard devices.devices.contains(where: { $0.id == id }) else {
        return [
          "installationId": id, "status": "setup",
          "message": "Open Ride On and enable notifications again to reconnect this device.",
        ]
      }
      guard configuration.automaticChecks && configuration.apns[receipt?.environment ?? ""] == true
      else {
        return [
          "installationId": id, "status": "unavailable",
          "message": "Notification delivery is temporarily unavailable.",
        ]
      }
      return [
        "installationId": id, "status": "ready",
        "message": "Notifications are enabled on this device.",
      ]
    }
    if link.enabled && receipt?.configured == false {
      return [
        "installationId": id, "status": "unavailable",
        "message": "Notification delivery is not available yet. Your ride is still being tracked.",
      ]
    }
    return [
      "installationId": id, "status": "setup",
      "message": "Open the Ride On app to finish notification setup.",
    ]
  }
}

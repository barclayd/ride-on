import Foundation
import Security
import UserNotifications

/// Shared only by the signed companion app and its Safari extension. Never use shared defaults for sessions.
enum PushStore {
    struct Link: Codable, Sendable {
        var owner: String
        var token: String
        var enabled = false
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
              !group.contains("$(") else { throw Failure("Notification sharing is not configured in this build.") }
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                kSecAttrAccount as String: key, kSecAttrAccessGroup as String: group]
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
        guard status == errSecSuccess, let data = result as? Data else { throw Failure("Unlock your device and try again.") }
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
        guard status == errSecSuccess else { throw Failure("Could not save notification setup. Try again after unlocking your device.") }
    }
    static func remove(_ key: String) throws {
        let status = SecItemDelete(try query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure("Could not clear notification setup.") }
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
    static func request(_ path: String, method: String, link: Link, body: [String: String]? = nil) async throws -> Data {
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
           var current: Link = try read("link"), current.owner == link.owner, current.token == link.token {
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
        guard let environment = Bundle.main.object(forInfoDictionaryKey: "RideOnPushEnvironment") as? String,
              ["sandbox", "production"].contains(environment) else { throw Failure("Push delivery is not configured in this build.") }
        let id = try installationID()
        let data = try await request("push-devices/\(id)", method: "PUT", link: link, body: [
            "token": deviceToken, "environment": environment, "topic": "com.danbarclay.rideon", "platform": platform, "scope": "tracked_rides"
        ])
        struct Registration: Decodable { var deliveryConfigured: Bool }
        let result = try JSONDecoder().decode(Registration.self, from: data)
        let current: Link? = try read("link")
        // If disable/sign-out raced the PUT, compensate after the registration finishes.
        guard current?.owner == link.owner, current?.enabled == true else {
            _ = try await request("push-devices/\(id)", method: "DELETE", link: link)
            return
        }
        try write("receipt", Receipt(owner: link.owner, deviceToken: deviceToken, configured: result.deliveryConfigured, environment: environment))
    }
    static func unlink() async throws {
        guard var link: Link = try read("link") else { return }
        link.enabled = false
        try write("link", link)
        try remove("receipt")
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        _ = try await request("push-devices/\(installationID())", method: "DELETE", link: link)
        try remove("link")
    }
    static func status() async throws -> [String: String] {
        let id = try installationID()
        guard let link: Link = try read("link") else {
            return ["installationId": id, "status": "off", "message": "Enable notifications in the Safari extension first."]
        }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        if settings.authorizationStatus == .denied {
            return ["installationId": id, "status": "blocked", "message": "Allow Ride On notifications in system settings."]
        }
        let receipt: Receipt? = try read("receipt")
        if link.enabled && receipt?.owner == link.owner && receipt?.configured == true && (settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional) {
            struct Configuration: Decodable { var automaticChecks: Bool; var apns: [String: Bool] }
            struct Devices: Decodable { struct Device: Decodable { var id: String }; var devices: [Device] }
            let configuration = try JSONDecoder().decode(Configuration.self, from: await request("push-devices/config", method: "GET", link: link))
            let devices = try JSONDecoder().decode(Devices.self, from: await request("push-devices", method: "GET", link: link))
            guard devices.devices.contains(where: { $0.id == id }) else {
                return ["installationId": id, "status": "setup", "message": "Open Ride On and enable notifications again to reconnect this device."]
            }
            guard configuration.automaticChecks && configuration.apns[receipt?.environment ?? ""] == true else {
                return ["installationId": id, "status": "unavailable", "message": "Notification delivery is temporarily unavailable."]
            }
            return ["installationId": id, "status": "ready", "message": "Notifications are enabled on this device."]
        }
        if link.enabled && receipt?.configured == false {
            return ["installationId": id, "status": "unavailable", "message": "Notification delivery is not available yet. Your ride is still being tracked."]
        }
        return ["installationId": id, "status": "setup", "message": "Open the Ride On app to finish notification setup."]
    }
}

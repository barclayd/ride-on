import Foundation
import Security

/// API sessions use the existing iOS App Group's keychain so the share extension
/// can import into the signed-in account. Strava and macOS retain their own store.
public enum KeychainStore {
    private static func query(_ account: String) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrAccount as String: account]
        #if os(iOS)
        if account.hasPrefix("ride-on-api-") {
            query[kSecAttrAccessGroup as String] = "group.com.danbarclay.rideon"
        }
        #endif
        return query
    }

    @discardableResult
    public static func set(_ data: Data, account: String) -> Bool {
        let query = query(account)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    public static func get(account: String) -> Data? {
        if let data = read(query(account)) { return data }
        #if os(iOS)
        // Existing installs migrate once, when the main app next reads its session.
        // The extension cannot read the main app's original private access group.
        if account.hasPrefix("ride-on-api-"), Bundle.main.bundleIdentifier == "com.danbarclay.rideon" {
            let legacy = legacyQuery(account)
            if let data = read(legacy), set(data, account: account) {
                SecItemDelete(legacy as CFDictionary)
                return data
            }
        }
        #endif
        return nil
    }

    private static func read(_ query: [String: Any]) -> Data? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    #if os(iOS)
    private static func legacyQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account,
         kSecAttrAccessGroup as String: "R2GGK3VN2C.com.danbarclay.rideon"]
    }
    #endif

    public static func delete(account: String) {
        SecItemDelete(query(account) as CFDictionary)
        #if os(iOS)
        if account.hasPrefix("ride-on-api-") { SecItemDelete(legacyQuery(account) as CFDictionary) }
        #endif
    }
}

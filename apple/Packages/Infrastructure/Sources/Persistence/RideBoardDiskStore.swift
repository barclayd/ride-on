import Foundation
import CryptoKit

/// Account-scoped bytes for the ride board cache. The application owns its
/// versioned Codable envelope; this store preserves the existing path and protection.
public struct RideBoardDiskStore: Sendable {
    private let directory: URL

    public init(directory: URL = URL.cachesDirectory.appending(path: "RideBoards")) {
        self.directory = directory
    }

    private func file(_ account: String) -> URL {
        let key = SHA256.hash(data: Data(account.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appending(path: key + ".json")
    }

    public func read(account: String) throws -> Data {
        try Data(contentsOf: file(account))
    }

    public func write(_ data: Data, account: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: file(account), options: .atomic)
        #if os(iOS)
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                              ofItemAtPath: file(account).path)
        #endif
    }

    public func remove(account: String) throws {
        try FileManager.default.removeItem(at: file(account))
    }
}

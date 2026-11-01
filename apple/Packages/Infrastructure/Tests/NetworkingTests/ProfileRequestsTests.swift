import Foundation
import Testing
@testable import Networking

private actor ProfileCounter {
    var calls = 0
    func fetch() async throws -> Data {
        calls += 1
        try await Task.sleep(for: .milliseconds(40))
        return Data("profile".utf8)
    }
}

struct ProfileRequestsTests {
    @Test func coalescesStartupReadsAndDiscardsValuesAfterMutation() async throws {
        let requests = ProfileRequests()
        let counter = ProfileCounter()
        async let first = requests.read(session: "a") { try await counter.fetch() }
        async let second = requests.read(session: "a") { try await counter.fetch() }
        _ = try await (first, second)
        #expect(await counter.calls == 1)
        _ = try await requests.read(session: "a") { try await counter.fetch() }
        #expect(await counter.calls == 1)
        await requests.invalidate()
        _ = try await requests.read(session: "a") { try await counter.fetch() }
        #expect(await counter.calls == 2)
        _ = try await requests.read(session: "b") { try await counter.fetch() }
        #expect(await counter.calls == 3)
    }
}

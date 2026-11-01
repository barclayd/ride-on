import Foundation
import Testing
@testable import Networking

struct ContractFixtureTests {
    private func fixture(_ name: String) throws -> Data {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }

    @Test func emptySelectionPreservesExplicitNull() throws {
        let response = try RideOnAPI.decoder.decode(RouteSelectionResponse.self, from: fixture("selection-empty"))
        #expect(response.selection.version == 0)
        #expect(response.selection.routeIds.isEmpty)
        #expect(response.selection.updatedAt == nil)
    }

    @Test func savedSelectionPreservesVersionIDsAndMilliseconds() throws {
        let response = try RideOnAPI.decoder.decode(RouteSelectionResponse.self, from: fixture("selection-saved"))
        #expect(response.selection.version == 7)
        #expect(response.selection.routeIds == ["6f1c2b9e-0c55-4d4e-9a7a-2f7d1d7e1a01"])
        #expect(response.selection.updatedAt == Date(timeIntervalSince1970: 1792749600))
    }

    @Test func conflictUsesTheSameErrorEnvelope() throws {
        let response = try RideOnAPI.decoder.decode(APIErrorResponse.self, from: fixture("error-conflict"))
        #expect(response.error.code == "SELECTION_VERSION_CONFLICT")
        #expect(response.error.message.contains("reconcile before retrying"))
    }
}

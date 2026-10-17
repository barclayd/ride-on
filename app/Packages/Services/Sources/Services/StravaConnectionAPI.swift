import Foundation
import CryptoKit

/// The shared Strava connection is held by the server. This client only holds a Ride On session.
public enum StravaConnectionAPI {
    public static let donePath = "/integrations/strava/done"

    public struct Status: Decodable, Sendable {
        public var configured: Bool
        public var connection: Connection?
        public init(configured: Bool, connection: Connection?) { self.configured = configured; self.connection = connection }
    }
    public struct Connection: Decodable, Sendable {
        public enum State: String, Decodable, Sendable { case connected, needsReauthorisation = "needs-reauthorisation" }
        public var status: State
        public var athleteId: String
        public var connectedAt: Date
        public var privateActivities: Bool
    }
    public struct CompletedRide: Decodable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var sportType: String
        public var startedAt: Date
        public var distanceKm: Double
        public var movingSeconds: Int
        public var elapsedSeconds: Int
        public var elevationGainM: Double
        public var url: URL
    }
    public struct History: Decodable, Sendable {
        public var rides: [CompletedRide]
        public var nextPage: Int?
        public var fetchedAt: Date
    }
    public struct Flow: Sendable {
        public var url: URL
        let requestId: String
        let verifier: String
        let state: String
        public var initialHeaders: [String: String] = [:]
    }

    public static func status() async throws -> Status { try await RideOnAPI.send("/connections/strava") }
    public static func history(page: Int = 1) async throws -> History {
        try await RideOnAPI.send("/connections/strava/rides", query: [.init(name: "page", value: String(page))])
    }
    public static func start() async throws -> Flow {
        let verifier = RideOnAPI.randomBase64URL(48)
        let state = RideOnAPI.randomBase64URL(24)
        let challenge = RideOnAPI.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        struct Input: Encodable { var state, codeChallenge: String }
        struct Output: Decodable { var requestId: String; var authorizationUrl: URL }
        let output: Output = try await RideOnAPI.send("/connections/strava/start", body: Input(state: state, codeChallenge: challenge))
        guard output.authorizationUrl.scheme == "https", output.authorizationUrl.host == RideOnAPI.host,
              output.authorizationUrl.port == nil, output.authorizationUrl.user == nil, output.authorizationUrl.password == nil,
              output.authorizationUrl.path == "/integrations/strava/authorize" else {
            throw RideOnAPI.Failure(status: 0, code: "STRAVA_INVALID_URL", message: "Strava could not start connecting. Please try again.")
        }
        return Flow(url: output.authorizationUrl, requestId: output.requestId, verifier: verifier, state: state,
                    initialHeaders: RideOnAPI.browserAuthorizationHeaders)
    }
    static func validate(callback: URL, flow: Flow) throws {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard callback.scheme == "https", callback.host == RideOnAPI.host, callback.path == donePath,
              callback.user == nil, callback.password == nil, callback.port == nil,
              items.filter({ $0.name == "state" }).count == 1,
              items.first(where: { $0.name == "state" })?.value == flow.state,
              items.filter({ $0.name == "result" }).count == 1,
              items.first(where: { $0.name == "result" })?.value == "ready" else {
            throw RideOnAPI.Failure(status: 0, code: "STRAVA_CONNECTION_INCOMPLETE", message: "Strava didn’t finish connecting. Please try again.")
        }
    }
    public static func finish(callback: URL, flow: Flow) async throws {
        try validate(callback: callback, flow: flow)
        struct Input: Encodable { var requestId, codeVerifier: String }
        struct Output: Decodable { var connected: Bool }
        let _: Output = try await RideOnAPI.send("/connections/strava/complete", body: Input(requestId: flow.requestId, codeVerifier: flow.verifier))
    }
    public static func disconnect() async throws -> String {
        struct Empty: Encodable {}
        struct Output: Decodable { var message: String }
        let output: Output = try await RideOnAPI.send("/connections/strava", method: "DELETE", body: Empty())
        return output.message
    }

    public static var sampleStatus: Status { .init(configured: true, connection: .init(status: .connected, athleteId: "12345", connectedAt: Date(timeIntervalSince1970: 1_792_152_000), privateActivities: true)) }
    public static var sampleHistory: History { .init(rides: [
        .init(id: "1", name: "Morning Gravel", sportType: "GravelRide", startedAt: Date(timeIntervalSince1970: 1_792_137_600), distanceKm: 42.1, movingSeconds: 6800, elapsedSeconds: 7200, elevationGainM: 450, url: URL(string: "https://www.strava.com/activities/1")!),
    ], nextPage: nil, fetchedAt: Date(timeIntervalSince1970: 1_792_152_000)) }
}

import Foundation

/// Codable transport adapters for API-owned contracts. Existing saved/client payloads
/// may omit updatedAt, so decoding deliberately remains tolerant of that older shape.
public struct RouteSelectionResponse: Decodable, Sendable {
    public struct Selection: Decodable, Sendable {
        public var version: Int
        public var routeIds: [String]
        public var updatedAt: Date?
    }
    public var selection: Selection
}

public struct APIErrorResponse: Decodable, Sendable {
    public struct Detail: Decodable, Sendable {
        public var code: String
        public var message: String
    }
    public var error: Detail
}

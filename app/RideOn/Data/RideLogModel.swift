import Foundation
import SwiftData

enum RideLogSource: String, Codable, Sendable {
    case manual
    case strava
    case healthKit
}

/// A record that a route was ridden — feeds the novelty scoring factor
/// (Phase 3). `routeID` is a plain UUID reference rather than a SwiftData
/// `@Relationship`.
///
/// ponytail: a loose UUID keeps this model simple and avoids relationship/
/// inverse ceremony (and its extra CloudKit schema surface) for what's just
/// a has-a link; promote to a real `@Relationship` if we need cascading
/// deletes or graph queries across routes <-> logs.
@Model
final class RideLogModel {
    var id: UUID = UUID()
    var date: Date = Date.now
    var routeID: UUID?
    var sourceRaw: String = RideLogSource.manual.rawValue

    init(
        id: UUID = UUID(),
        date: Date = .now,
        routeID: UUID? = nil,
        source: RideLogSource = .manual
    ) {
        self.id = id
        self.date = date
        self.routeID = routeID
        self.sourceRaw = source.rawValue
    }
}

extension RideLogModel {
    var source: RideLogSource {
        get { RideLogSource(rawValue: sourceRaw) ?? .manual }
        set { sourceRaw = newValue.rawValue }
    }
}

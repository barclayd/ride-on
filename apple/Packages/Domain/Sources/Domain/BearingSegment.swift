import Foundation

/// One ~1km slice of a track with the compass bearing of travel across it —
/// the raw material for the wind-alignment scoring factor (Phase 3). Lives in
/// Models (not Engine, which produces it) since `RouteModel` persists it and
/// Engine depends on Models, not the other way round.
public struct BearingSegment: Codable, Sendable, Hashable {
    public var bearingDegrees: Double
    public var lengthKm: Double

    public init(bearingDegrees: Double, lengthKm: Double) {
        self.bearingDegrees = bearingDegrees
        self.lengthKm = lengthKm
    }
}

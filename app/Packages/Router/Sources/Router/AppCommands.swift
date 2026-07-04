import Foundation

/// Cross-feature signal for the Mac menu bar (RideOnApp's `.commands`) to
/// reach into RoutesUI's file importer — the App shell owns the `Commands`
/// (they're scene-level, not view-level) but only RoutesUI owns the GPX
/// import UI, so a plain `Notification` is the lightest connective tissue
/// between the two (ponytail: no new cross-feature router destination type
/// needed for a fire-and-forget signal like this).
public extension Notification.Name {
    static let rideOnImportGPXRequested = Notification.Name("rideOnImportGPXRequested")
}

import Foundation

/// Cross-feature navigation payloads. Feature packages (TodayUI, RoutesUI,
/// YouUI) can't import each other, so a screen that needs to push into
/// another feature's UI (e.g. a Today card opening Route Detail, which lives
/// in RoutesUI) pushes one of these values instead. The App shell — the only
/// target that imports every Features product — owns the single
/// `.navigationDestination(for: RouterDestination.self)` that turns a value
/// back into a concrete view.
public enum RouterDestination: Hashable, Sendable {
    case routeDetail(routeID: UUID)
}

import Foundation
import SwiftUI

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

/// Programmatic push into the enclosing tab's `NavigationStack` — set by the
/// App shell (which owns the stack's path), consumed by feature views that
/// navigate outside a `NavigationLink` tap (e.g. the breakdown sheet's
/// View Route button, which has to dismiss the sheet first).
public struct NavigateAction: Sendable {
    private let handler: @MainActor @Sendable (RouterDestination) -> Void

    public init(handler: @escaping @MainActor @Sendable (RouterDestination) -> Void) {
        self.handler = handler
    }

    @MainActor
    public func callAsFunction(_ destination: RouterDestination) {
        handler(destination)
    }
}

public extension EnvironmentValues {
    @Entry var navigate: NavigateAction = NavigateAction { _ in }
}

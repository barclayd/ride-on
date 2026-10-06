import SwiftUI

/// The focused `RouteDetailView`'s "open the edit sheet" action. Equatable on
/// the owning view's identity rather than the closure (closures aren't
/// comparable, so a bare `() -> Void` entry invalidated the menu bar on every
/// update): the closure only flips that view's own `isEditing`, so two actions
/// from the same view are interchangeable.
public struct RouteEditAction: Equatable {
    let owner: UUID
    let open: () -> Void

    public func callAsFunction() { open() }

    public static func == (lhs: Self, rhs: Self) -> Bool { lhs.owner == rhs.owner }
}

public extension FocusedValues {
    /// Set by the focused `RouteDetailView`; nil when no route is showing.
    /// Lets the Mac menu bar's "Edit Route Details…" command drive the same
    /// sheet the toolbar button opens (and auto-disable when there's no route).
    @Entry var routeEditAction: RouteEditAction?
}

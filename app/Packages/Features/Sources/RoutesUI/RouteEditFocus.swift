import SwiftUI

public extension FocusedValues {
    /// Set by the focused `RouteDetailView` to its "open the edit sheet"
    /// action; nil when no route is showing. Lets the Mac menu bar's
    /// "Edit Route Details…" command drive the same sheet the toolbar button
    /// opens (and auto-disable when there's no route). ponytail: a plain
    /// closure, not a wrapper type — FocusedValues doesn't need Equatable.
    @Entry var routeEditAction: (() -> Void)?
}

import SwiftUI

/// The shape a tab's content has to fill on iPhone, from its own size (DESIGN-SYSTEM.md §5,
/// Breakpoints). Never a device check: the iPhone Duo's poses land on these by size alone, and an
/// ordinary iPhone is `narrow` in portrait and `tent` in landscape.
public enum PaneShape: Hashable, Sendable {
    /// One column: a closed Duo (about 394pt beside the rail), any other iPhone, half an open Duo.
    case narrow
    /// Landscape on the outer display, standing on its edges (about 606 × 466 beside the rail),
    /// and any other iPhone in landscape.
    case tent
    /// The inner display in portrait (669 wide): one screen, horizontal bars.
    case portrait
    /// The inner display in landscape (about 879 × 669 beside the rail): two panes side by side.
    case wide

    public init(_ size: CGSize) {
        if size.width >= 700 && size.height >= 560 {
            self = .wide
        } else if size.width > size.height {
            self = .tent
        } else if size.width >= 600 {
            self = .portrait
        } else {
            self = .narrow
        }
    }
}

public extension EnvironmentValues {
    /// The tab content's shape on iPhone; nil where the app doesn't manage it (the Mac, iPad's
    /// split view), so screens keep their size-class layouts there.
    @Entry var paneShape: PaneShape?
}

public extension View {
    /// Measures the space this view is given and hands its `PaneShape` down. Synchronous, so the
    /// first frame already has the right layout.
    func measuresPaneShape() -> some View {
        modifier(MeasuresPaneShape())
    }
}

private struct MeasuresPaneShape: ViewModifier {
    func body(content: Content) -> some View {
        GeometryReader { proxy in
            content
                .environment(\.paneShape, PaneShape(proxy.size))
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}

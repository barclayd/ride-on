import SwiftUI
import DesignSystem

/// The heights the Routes panel rests at on iPhone, as Find My's sheet: collapsed leaves just the
/// grabber showing around the tab bar, small the title and the top of the shortlist, medium half
/// the screen and large all of it.
enum PanelDetent: CaseIterable, Hashable {
    case collapsed, small, medium, large
}

/// Where the panel rests, measured up from the bottom of the screen, and the band the tab bar
/// floats in there.
struct PanelHeights: Equatable {
    var small: CGFloat
    var medium: CGFloat
    var large: CGFloat
    var tabBar: CGFloat
}

/// The Routes panel: regular glass over the map, a pinned header (grabber, then the caller's) and
/// everything else scrolling beneath it. On iPhone it runs behind the tab bar to the bottom of the
/// screen and moves like Find My's sheet: the list scrolls at every height but collapsed, a drag
/// on the header moves the panel, and so does pulling the list down from its top. Let go, it
/// settles on the detent its momentum carries it to. With `heights` nil (iPad, Mac) it fills the
/// height it's given and has no grabber.
struct FloatingPanel<Header: View, Content: View>: View {
    @Binding var detent: PanelDetent
    /// Nil for a fixed panel.
    var heights: PanelHeights?
    /// Whether the list has scrolled off its top.
    @Binding var scrolled: Bool
    /// Called when the panel settles below large, so search can give up focus.
    var lowered: () -> Void
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    @State private var drag: CGFloat = 0
    @State private var handleHeight: CGFloat = 0
    @State private var position = ScrollPosition(edge: .top)
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let height = heights.map(height(in:))
        let inset = heights.map { Self.inset(at: height!, in: $0) } ?? 0
        // The header and list fade out as the panel closes on the tab bar, leaving the grabber.
        let shown = heights.map { min(max((height! - rest(.collapsed, in: $0)) / 32, 0), 1) } ?? 1
        let hidden = heights != nil && detent == .collapsed

        ScrollView {
            content
                .padding(.bottom, 14)
                .opacity(shown)
                .accessibilityHidden(hidden)
        }
        .scrollPosition($position)
        .scrollDisabled(hidden)
        .scrollDismissesKeyboard(.interactively)
        // Clear of the tab bar, or with search in use the keyboard.
        .contentMargins(.bottom, heights.map { max($0.tabBar - inset, 0) } ?? 0)
        .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 1 } action: {
            scrolled = $1
        }
        .safeAreaBar(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                // Room for the grabber, which sits over the panel rather than in this bar: the bar
                // isn't drawn when collapsed leaves the scroll view too short to hold it.
                Color.clear.frame(height: heights == nil ? 12 : 20)
                header
                    .opacity(shown)
                    .allowsHitTesting(!hidden)
                    .accessibilityHidden(hidden)
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { handleHeight = $0 }
        }
        // Beside the map on iPad and Mac the rows fade out into the panel's bottom edge rather than
        // being cut off by it; on iPhone they run on under the tab bar.
        .mask {
            VStack(spacing: 0) {
                Color.black
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: heights == nil ? 22 : 0)
            }
        }
        .frame(height: height.map { max($0 - inset, 0) })
        .frame(maxHeight: heights == nil ? .infinity : nil)
        .overlay(alignment: .top) {
            if heights != nil {
                grabber
                    .accessibilitySortPriority(1)
            }
        }
        .clipShape(shape)
        .accessibleGlass(.regular, in: shape, fallback: .groupedBackground)
        #if os(iOS)
        // Collapsed, all that shows is the strip above the tab bar, and it all drags the panel.
        .gesture(PanelDrag(enabled: heights != nil, handle: hidden ? .infinity : handleHeight) { drag = $0 } ended: {
            release(velocity: $0)
        })
        #endif
        .padding([.horizontal, .bottom], inset)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Routes")
    }

    /// On iPhone the bottom corners follow the screen's, as a sheet's do.
    private var shape: ConcentricRectangle {
        ConcentricRectangle(uniformTopCorners: .fixed(CornerRadius.floatingPanel),
                            uniformBottomCorners: heights == nil ? .fixed(CornerRadius.floatingPanel)
                                : .concentric(minimum: .fixed(CornerRadius.floatingPanel)))
    }

    private var grabber: some View {
        Button {
            settle(on: tapped)
        } label: {
            Capsule()
                .fill(.tertiary)
                .frame(width: 36, height: 5)
                .frame(maxWidth: .infinity, minHeight: 20)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(detent == .large ? "Collapse panel" : "Expand panel")
        .accessibilityActions {
            if detent != .collapsed {
                Button("Dismiss panel") { settle(on: .collapsed) }
            }
        }
    }

    /// Where a tap on the grabber takes the panel: up a detent, or from large back to medium.
    private var tapped: PanelDetent {
        switch detent {
        case .collapsed: .small
        case .small: .medium
        case .medium: .large
        case .large: .medium
        }
    }

    // MARK: Dragging

    /// Settles the panel let go at `velocity` (points per second, downwards positive) on the
    /// detent it would coast to.
    private func release(velocity: CGFloat) {
        guard let heights else { return }
        let current = height(in: heights)
        let velocity = -velocity
        // Where the panel would come to rest if it coasted (scroll deceleration), so a flick
        // throws it past the next detent.
        let projected = current + velocity / 1000 * 0.998 / (1 - 0.998)
        let target = PanelDetent.allCases.min { abs(projected - rest($0, in: heights)) < abs(projected - rest($1, in: heights)) }!
        let remaining = rest(target, in: heights) - current
        settle(on: target, velocity: abs(remaining) > 1 ? velocity / remaining : 0)
    }

    private func settle(on target: PanelDetent, velocity: Double = 0) {
        withAnimation(reduceMotion ? Motion.panelMaterialize : Motion.panelDetent(velocity: velocity)) {
            detent = target
            drag = 0
            // Collapsed hides the list, so it goes back to its top.
            if target == .collapsed { position.scrollTo(edge: .top) }
        }
        if target != .large { lowered() }
    }

    /// The panel's height resting at `detent`: collapsed shows just the grabber above the tab bar.
    private func rest(_ detent: PanelDetent, in heights: PanelHeights) -> CGFloat {
        switch detent {
        case .collapsed: heights.tabBar + 22
        case .small: heights.small
        case .medium: heights.medium
        case .large: heights.large
        }
    }

    /// The panel's height for the drag so far, resisting more the further it's pulled past
    /// collapsed or large.
    private func height(in heights: PanelHeights) -> CGFloat {
        let lower = rest(.collapsed, in: heights)
        let raw = rest(detent, in: heights) - drag
        if raw > heights.large { return heights.large + Self.rubberBand(raw - heights.large) }
        if raw < lower { return lower - Self.rubberBand(lower - raw) }
        return raw
    }

    /// How far the panel stands off the screen's sides and bottom at `height`: a tray around the
    /// tab bar up to small, closing to the edges by large.
    private static func inset(at height: CGFloat, in heights: PanelHeights) -> CGFloat {
        if height <= heights.small { return 12 }
        if height <= heights.medium { return 12 - 6 * (height - heights.small) / max(heights.medium - heights.small, 1) }
        if height <= heights.large { return 6 - 6 * (height - heights.medium) / max(heights.large - heights.medium, 1) }
        return 0
    }

    private static func rubberBand(_ overshoot: CGFloat, dimension: CGFloat = 300) -> CGFloat {
        overshoot * dimension * 0.55 / (dimension + 0.55 * overshoot)
    }
}

extension View {
    /// Glass, or with Reduce Transparency an opaque `fallback`, and with Increase Contrast the
    /// fallback with a border (DESIGN-SYSTEM.md §2, §8).
    func accessibleGlass(_ glass: Glass, in shape: some Shape, fallback: Color) -> some View {
        modifier(AccessibleGlass(glass: glass, shape: shape, fallback: fallback))
    }
}

private struct AccessibleGlass<S: Shape>: ViewModifier {
    var glass: Glass
    var shape: S
    var fallback: Color
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content
                .background(fallback, in: shape)
                .overlay {
                    if contrast == .increased {
                        // Clipped to the shape, so the border sits inside its edge.
                        shape.stroke(.primary.opacity(0.4), lineWidth: 2)
                            .clipShape(shape)
                    }
                }
        } else {
            content.glassEffect(glass, in: shape)
        }
    }
}

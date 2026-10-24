import SwiftUI
import DesignSystem

/// The heights the Routes panel rests at on iPhone. Collapsed is just the header, so the map has
/// the screen.
enum PanelDetent: Hashable {
    case collapsed, medium, large
}

/// The Routes panel: regular glass floating over the map, a pinned header (grabber, search, add)
/// and everything else scrolling beneath it. On iPhone it rests collapsed or at `heights`' two ends
/// and tracks a drag on its header 1:1, settling on the detent the drag was heading for; with
/// `heights` nil (iPad, Mac) it fills the height it's given and has no grabber.
struct FloatingPanel<Header: View, Content: View>: View {
    @Binding var detent: PanelDetent
    /// Medium...large, or nil for a fixed panel.
    var heights: ClosedRange<CGFloat>?
    /// Called when the panel settles below large, so search can give up focus.
    var collapsed: () -> Void
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content

    @State private var drag: CGFloat = 0
    @State private var pull: CGFloat = 0
    @State private var headerHeight: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            content
                .padding(.bottom, 14)
                .accessibilityHidden(detent == .collapsed && heights != nil)
        }
        .scrollDismissesKeyboard(.interactively)
        // Pulled down past the top, the panel lets go a detent, like a sheet.
        .onScrollGeometryChange(for: CGFloat.self) { -($0.contentOffset.y + $0.contentInsets.top) } action: { _, pull in
            self.pull = pull
        }
        .onScrollPhaseChange { old, _ in
            if old == .interacting, pull > 60, detent != .collapsed, heights != nil {
                settle(on: detent == .large ? .medium : .collapsed)
            }
        }
        .safeAreaBar(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                if heights != nil {
                    grabber
                } else {
                    Color.clear.frame(height: 12)
                }
                header
            }
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { headerHeight = $0 }
            .contentShape(.rect)
            .gesture(dragGesture, isEnabled: heights != nil)
        }
        // The rows fade out into the panel's bottom edge rather than being cut off by it; the fade
        // shrinks as the panel closes on its header, so the search field never fades.
        .mask {
            VStack(spacing: 0) {
                Color.black
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: heights.map { min(max(height(in: $0) - headerHeight, 0), 22) } ?? 22)
            }
        }
        .frame(height: heights.map(height(in:)))
        .frame(maxHeight: heights == nil ? .infinity : nil)
        .clipShape(.rect(cornerRadius: CornerRadius.floatingPanel))
        .accessibleGlass(.regular, in: .rect(cornerRadius: CornerRadius.floatingPanel), fallback: .groupedBackground)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Routes")
    }

    private var grabber: some View {
        Button {
            settle(on: detent == .medium ? .large : .medium)
        } label: {
            Capsule()
                .fill(.tertiary)
                .frame(width: 36, height: 5)
                .frame(maxWidth: .infinity, minHeight: 20)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // Ahead of the button, or a short drag on the grabber lands as a tap and expands the panel.
        .highPriorityGesture(dragGesture, isEnabled: heights != nil)
        .accessibilityLabel(detent == .large ? "Collapse panel" : "Expand panel")
        .accessibilityActions {
            if detent != .collapsed {
                Button("Dismiss panel") { settle(on: .collapsed) }
            }
        }
    }

    // MARK: Dragging

    private var dragGesture: some Gesture {
        // Global, since the header moves with the panel as it grows.
        DragGesture(minimumDistance: 6, coordinateSpace: .global)
            .onChanged { drag = $0.translation.height }
            .onEnded { value in
                guard let heights else { return }
                let current = height(in: heights)
                let velocity = -value.velocity.height
                // Where the panel would come to rest if it coasted (scroll deceleration), so a
                // flick throws it to the far detent.
                let projected = current + velocity / 1000 * 0.998 / (1 - 0.998)
                let target = [PanelDetent.collapsed, .medium, .large].min { abs(projected - rest($0, in: heights)) < abs(projected - rest($1, in: heights)) }!
                let remaining = rest(target, in: heights) - current
                settle(on: target, velocity: abs(remaining) > 1 ? velocity / remaining : 0)
            }
    }

    private func settle(on target: PanelDetent, velocity: Double = 0) {
        withAnimation(reduceMotion ? Motion.panelMaterialize : Motion.panelDetent(velocity: velocity)) {
            detent = target
            drag = 0
        }
        if target != .large { collapsed() }
    }

    /// The panel's height resting at `detent`: collapsed shows just the header.
    private func rest(_ detent: PanelDetent, in heights: ClosedRange<CGFloat>) -> CGFloat {
        switch detent {
        case .collapsed: min(headerHeight, heights.lowerBound)
        case .medium: heights.lowerBound
        case .large: heights.upperBound
        }
    }

    /// The panel's height for the drag so far, resisting more the further it's pulled past
    /// collapsed or large.
    private func height(in heights: ClosedRange<CGFloat>) -> CGFloat {
        let lower = rest(.collapsed, in: heights)
        let raw = rest(detent, in: heights) - drag
        if raw > heights.upperBound { return heights.upperBound + Self.rubberBand(raw - heights.upperBound) }
        if raw < lower { return lower - Self.rubberBand(lower - raw) }
        return raw
    }

    private static func rubberBand(_ overshoot: CGFloat, dimension: CGFloat = 300) -> CGFloat {
        overshoot * dimension * 0.55 / (dimension + 0.55 * overshoot)
    }
}

extension View {
    /// Glass, or with Reduce Transparency an opaque `fallback`, and with Increase Contrast the
    /// fallback with a border (DESIGN-SYSTEM.md §2, §8).
    func accessibleGlass(_ glass: Glass, in shape: some InsettableShape, fallback: Color) -> some View {
        modifier(AccessibleGlass(glass: glass, shape: shape, fallback: fallback))
    }
}

private struct AccessibleGlass<S: InsettableShape>: ViewModifier {
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
                        shape.strokeBorder(.primary.opacity(0.4), lineWidth: 1)
                    }
                }
        } else {
            content.glassEffect(glass, in: shape)
        }
    }
}

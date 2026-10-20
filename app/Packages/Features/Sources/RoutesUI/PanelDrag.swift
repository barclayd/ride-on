#if os(iOS)
import SwiftUI
import UIKit

/// The Routes panel's drag, as a UIKit pan so it can share a touch with the list's scroll view the
/// way a sheet does: below large the drag moves the panel wherever it starts; at large the list
/// scrolls, and pulling it down from its top takes the panel down with the finger instead.
struct PanelDrag: UIGestureRecognizerRepresentable {
    /// False for a panel without detents.
    var enabled: Bool
    /// Whether the panel rests at large, where the list has the drag until it's at its top.
    var expanded: Bool
    /// The panel's travel so far, downwards positive.
    var changed: (CGFloat) -> Void
    /// The panel was let go at this vertical velocity, downwards positive.
    var ended: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
        pan.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let coordinator = context.coordinator
        // In the window, since the panel moves under the finger.
        let translation = pan.translation(in: nil).y
        switch pan.state {
        case .began:
            coordinator.begin(expanded: expanded, at: translation)
        case .changed:
            if let travel = coordinator.travel(to: translation) { changed(travel) }
        case .ended, .cancelled, .failed:
            if coordinator.end() { ended(pan.velocity(in: nil).y) }
        default:
            break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        /// The list's scroll view, when this touch is shared with it.
        private weak var list: UIScrollView?
        private var expanded = false
        private var moving = false
        private var last: CGFloat = 0
        private var travel: CGFloat = 0

        func begin(expanded: Bool, at translation: CGFloat) {
            self.expanded = expanded
            moving = !expanded
            // From here, not the touch-down, so the panel doesn't jump by the pan's slop.
            last = translation
            travel = 0
        }

        /// The panel's travel with the finger at `translation`, or nil while the list has it.
        func travel(to translation: CGFloat) -> CGFloat? {
            let delta = translation - last
            last = translation
            if !moving {
                guard delta > 0, list.map(Self.atTop) ?? true else { return nil }
                // The list is at its top and the finger turned down: the panel takes over, and
                // cancelling the list's pan stops it bouncing or scrolling under the finger.
                moving = true
                list?.panGestureRecognizer.isEnabled = false
                list?.panGestureRecognizer.isEnabled = true
            }
            travel += delta
            return travel
        }

        /// Whether the panel moved, so needs settling.
        func end() -> Bool {
            defer { list = nil; moving = false }
            return moving
        }

        private static func atTop(_ scrollView: UIScrollView) -> Bool {
            scrollView.contentOffset.y <= -scrollView.adjustedContentInset.top + 1
        }

        // MARK: UIGestureRecognizerDelegate

        /// Vertical drags only, so the shortlist carousel keeps its horizontal swipes.
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
            let translation = pan.translation(in: nil)
            return abs(translation.y) > abs(translation.x)
        }

        /// Shares the touch with the list (the vertical scroll view), not the carousel.
        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            guard let scrollView = other.view as? UIScrollView, other === scrollView.panGestureRecognizer,
                  scrollView.contentSize.width <= scrollView.bounds.width + 1 else { return false }
            list = scrollView
            return true
        }
    }
}
#endif

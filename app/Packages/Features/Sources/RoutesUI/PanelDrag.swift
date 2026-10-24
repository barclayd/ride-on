#if os(iOS)
import SwiftUI
import UIKit

/// The Routes panel's drag, as a UIKit pan so it can share a touch with the list's scroll view the
/// way a sheet does: a drag that starts on the panel's handle (grabber and header) moves the panel;
/// one that starts on the list scrolls it, until the list is pulled down from its top, when the
/// panel goes down with the finger instead.
struct PanelDrag: UIGestureRecognizerRepresentable {
    /// False for a panel without detents.
    var enabled: Bool
    /// The height of the strip at the panel's top that always drags it.
    var handle: CGFloat
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
            // Where the touch came down on the panel, not where the pan began past its slop.
            let start = context.converter.localLocation.y - (context.converter.localTranslation?.y ?? 0)
            coordinator.begin(onHandle: start < handle, at: translation)
        case .changed:
            if let travel = coordinator.travel(to: translation) { changed(travel) }
        case .ended, .cancelled, .failed:
            if coordinator.end() { ended(pan.velocity(in: nil).y) }
        default:
            break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        /// The list's scroll view, when the touch is on it.
        private weak var list: UIScrollView?
        private var moving = false
        private var last: CGFloat = 0
        private var travel: CGFloat = 0

        func begin(onHandle: Bool, at translation: CGFloat) {
            moving = onHandle
            // The handle has the drag, so nothing under it scrolls.
            if onHandle { cancelList() }
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
                // The list is at its top and the finger turned down: the panel takes over.
                moving = true
                cancelList()
            }
            travel += delta
            return travel
        }

        /// Whether the panel moved, so needs settling.
        func end() -> Bool {
            defer { moving = false }
            return moving
        }

        /// Stops the list's pan, so it doesn't bounce or scroll under the finger.
        private func cancelList() {
            list?.panGestureRecognizer.isEnabled = false
            list?.panGestureRecognizer.isEnabled = true
        }

        private static func atTop(_ scrollView: UIScrollView) -> Bool {
            scrollView.contentOffset.y <= -scrollView.adjustedContentInset.top + 1
        }

        /// The list scrolls vertically; the shortlist carousel inside it doesn't.
        private static func isList(_ scrollView: UIScrollView) -> Bool {
            scrollView.contentSize.width <= scrollView.bounds.width + 1
        }

        /// The list the touch is in, past the carousel if it's on that.
        private static func list(containing view: UIView?) -> UIScrollView? {
            guard let view else { return nil }
            if let scrollView = view as? UIScrollView, isList(scrollView) { return scrollView }
            return list(containing: view.superview)
        }

        // MARK: UIGestureRecognizerDelegate

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            list = Self.list(containing: touch.view)
            return true
        }

        /// Vertical drags only, so the shortlist carousel keeps its horizontal swipes.
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
            let translation = pan.translation(in: nil)
            return abs(translation.y) > abs(translation.x)
        }

        /// Shares the touch with the list, not the carousel.
        func gestureRecognizer(_ recognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            guard let scrollView = other.view as? UIScrollView, other === scrollView.panGestureRecognizer,
                  Self.isList(scrollView) else { return false }
            if list == nil { list = scrollView }
            return true
        }
    }
}
#endif

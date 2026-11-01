import SwiftUI

/// Animation tokens per DESIGN-SYSTEM.md §7. Reach for these instead of
/// hand-rolling `.animation()` calls so motion stays consistent app-wide.
public enum Motion {
    /// Layout change accompanying a glass pill tap.
    public static let glassTapLayout: Animation = .snappy
    /// Ambiance crossfade: dial screens, card weather.
    public static let ambianceCrossfade: Animation = .smooth(duration: 0.8)
    /// Onboarding page transitions.
    public static let onboardingPageTransition: Animation = .spring(response: 0.45, dampingFraction: 0.85)
    /// Panel/content materialize — async-loaded content (e.g. the best-day
    /// badge, Today's spinner -> ranked-list swap) arriving in an
    /// already-visible layout.
    public static let panelMaterialize: Animation = .smooth
    /// Score-ring fill on first appearance (Fitness-style: the score reads
    /// as computed, not painted).
    public static let ringFill: Animation = .smooth(duration: 0.8)
    /// A pane taking the whole screen or giving it back (iPhone Duo's Full Screen and Show Rides):
    /// the other pane fades as this one widens.
    public static let paneResize: Animation = .smooth
    /// The Routes panel settling on a detent. `velocity` carries the drag's speed into the
    /// spring, as a fraction of the distance left per second, so release has no seam.
    public static func panelDetent(velocity: Double = 0) -> Animation {
        .interpolatingSpring(Spring(response: 0.35, dampingRatio: 0.86), initialVelocity: velocity)
    }
}

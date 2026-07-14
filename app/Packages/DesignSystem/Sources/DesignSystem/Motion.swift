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
    /// badge) arriving in an already-visible layout.
    public static let panelMaterialize: Animation = .smooth
}

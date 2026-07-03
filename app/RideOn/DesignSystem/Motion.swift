import SwiftUI

/// Animation tokens per DESIGN-SYSTEM.md §7. Reach for these instead of
/// hand-rolling `.animation()` calls so motion stays consistent app-wide.
enum Motion {
    /// Sheet presentation, panel materialize.
    static let sheetPresentation: Animation = .smooth(duration: 0.5)
    /// Layout change accompanying a glass pill tap.
    static let glassTapLayout: Animation = .snappy
    /// Ambiance crossfade: dial screens, card weather.
    static let ambianceCrossfade: Animation = .smooth(duration: 0.8)
    /// Onboarding page transitions.
    static let onboardingPageTransition: Animation = .spring(response: 0.45, dampingFraction: 0.85)
}

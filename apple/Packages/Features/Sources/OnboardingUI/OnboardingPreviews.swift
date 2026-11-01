import Persistence
import SwiftUI
import Services

// In their own file: the preview thunk can't type-check OnboardingView.swift's own builders.
// The iPhone Duo's poses beside the rail (PaneShape), for the canvas: the simulator can't unfold.
// Previews have no rail, so they show the steps' own Continue and Skip.
#Preview("Tent", traits: .fixedLayout(width: 606, height: 466)) {
    OnboardingView(step: 1)
        .environment(PreferencesStore(defaults: UserDefaults(suiteName: "onboarding-preview")!))
}

#Preview("Open, landscape", traits: .fixedLayout(width: 879, height: 669)) {
    OnboardingView(step: 1)
        .environment(PreferencesStore(defaults: UserDefaults(suiteName: "onboarding-preview")!))
}

#Preview("Open, landscape, welcome", traits: .fixedLayout(width: 879, height: 669)) {
    OnboardingView()
        .environment(PreferencesStore(defaults: UserDefaults(suiteName: "onboarding-preview")!))
}

import SwiftUI
import Accessibility
import Models
import Services
import DesignSystem
import SharedUI

/// The 9-step first-run flow (PLAN.md decision record): a feature-splash
/// welcome, four reactive weather-dial screens (temp/sun/rain/wind — the
/// animation centrepiece), a novelty dial, a Strava connect step, a
/// speed-prefill review, and a finish screen. Every step but welcome is
/// individually skippable. `PreferencesStore.hasCompletedOnboarding` gates
/// this view at the app root and flips to `true` on finish, so the app
/// reactively swaps to `RootView` with no relaunch needed.
public struct OnboardingView: View {
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(\.services) private var services
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var step = 0
    @State private var isStravaConnected = false
    @State private var isConnectingStrava = false
    /// Back slides the pages the other way.
    @State private var goingBack = false

    static let stepCount = 9

    public init() {}

    /// Opens on a later step, for previews.
    init(step: Int) {
        _step = State(initialValue: step)
    }

    public var body: some View {
        #if os(iOS)
        // In a stack on iPhone so the iPhone Duo's rail can carry Back, Continue and Skip.
        if UIDevice.current.userInterfaceIdiom == .phone {
            NavigationStack { flow }
                .measuresPaneShape()
        } else {
            flow
        }
        #else
        flow
        #endif
    }

    private var flow: some View {
        let isLast = step == Self.stepCount - 1
        let next: () -> Void = isLast ? { finish() } : { advance() }
        return pages
            .modifier(OnboardingControls(
                step: step,
                onBack: { back() },
                onContinue: next,
                // Welcome is the one step you can't skip; skipping the last finishes.
                onSkip: step == 0 ? nil : next
            ))
    }

    private var pages: some View {
        @Bindable var preferencesStore = preferencesStore

        return Group {
            switch step {
            case 0:
                WelcomeStep(pageIndex: 0, pageCount: Self.stepCount, onContinue: advance)
            case 1:
                TemperatureDialStep(range: $preferencesStore.preferences.preferredTempRangeC, pageIndex: 1, pageCount: Self.stepCount, onContinue: advance)
            case 2:
                SunDialStep(preference: $preferencesStore.preferences.sunPreference, pageIndex: 2, pageCount: Self.stepCount, onContinue: advance)
            case 3:
                RainDialStep(tolerance: $preferencesStore.preferences.rainTolerance, pageIndex: 3, pageCount: Self.stepCount, onContinue: advance)
            case 4:
                WindDialStep(maxWindKph: $preferencesStore.preferences.maxWindKph, pageIndex: 4, pageCount: Self.stepCount, onContinue: advance)
            case 5:
                NoveltyDialStep(noveltyDial: $preferencesStore.preferences.noveltyDial, pageIndex: 5, pageCount: Self.stepCount, onContinue: advance)
            case 6:
                StravaConnectStep(
                    isConnected: isStravaConnected,
                    isConnecting: isConnectingStrava,
                    pageIndex: 6,
                    pageCount: Self.stepCount,
                    onConnect: connectStrava,
                    onContinue: advance
                )
            case 7:
                SpeedPrefillStep(
                    speedKphBySurface: preferencesStore.preferences.speedKphBySurface,
                    isStravaConnected: isStravaConnected,
                    pageIndex: 7,
                    pageCount: Self.stepCount,
                    onContinue: advance
                )
            default:
                FinishStep(pageIndex: 8, pageCount: Self.stepCount, onContinue: finish)
            }
        }
        .transition(.asymmetric(
            insertion: .move(edge: goingBack ? .leading : .trailing).combined(with: .opacity),
            removal: .move(edge: goingBack ? .trailing : .leading).combined(with: .opacity)
        ))
        .animation(reduceMotion ? nil : Motion.onboardingPageTransition, value: step)
        // The Group-switch page flow isn't a real navigation push, so
        // VoiceOver gets no screen-change cue without this (REDESIGN.md F).
        .onChange(of: step) {
            AccessibilityNotification.ScreenChanged().post()
        }
    }

    private func advance() {
        goingBack = false
        step = min(step + 1, Self.stepCount - 1)
    }

    private func back() {
        goingBack = true
        step = max(step - 1, 0)
    }

    private func connectStrava() {
        // The old direct-token client is retained for fixture tests only. Live
        // connections require a Ride On login and are managed in Preferences.
        guard FixtureWorld.isEnabled else { return }
        isConnectingStrava = true
        Task {
            try? await StravaConnect.connect(using: services.strava)
            let connected = await services.strava.isConnected()
            let routes = connected ? ((try? await services.strava.importedRoutes()) ?? []) : []
            isConnectingStrava = false
            isStravaConnected = connected
            if !routes.isEmpty {
                // ponytail: a static "connected" preset, not the real
                // `SpeedModelDerivation` from 3 months of activity history
                // (`StravaActivitySyncService`, You → Speed & Climbing) —
                // that fetch is too slow to block an onboarding step on.
                // Just makes the prefill UX real end-to-end; the real
                // derivation runs post-onboarding on demand.
                preferencesStore.preferences.speedKphBySurface = [
                    .paved: 27, .busyRoad: 24, .unpaved: 18, .path: 15,
                ]
            }
        }
    }

    private func finish() {
        preferencesStore.hasCompletedOnboarding = true
    }
}

/// Back, Continue and Skip. On the iPhone Duo's rail: Back at the top, Continue under it, Skip
/// at the rail's foot (DESIGN-SYSTEM.md §5, the rail audit), with the steps' own CTA left out.
/// Elsewhere the steps keep their Continue and Skip floats top-trailing, as a plain system `.glass`
/// button (free Reduce Transparency fallback, DESIGN-SYSTEM.md §1.2) over the step's ambiance.
private struct OnboardingControls: ViewModifier {
    var step: Int
    var onBack: () -> Void
    var onContinue: () -> Void
    var onSkip: (() -> Void)?
    #if os(iOS)
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    #endif
    @State private var continueTapCount = 0

    private var onRail: Bool {
        #if os(iOS)
        toolbarVerticalEdge != nil
        #else
        false
        #endif
    }

    // One chain for both, so opening or closing the phone never rebuilds the step.
    func body(content: Content) -> some View {
        content
            .environment(\.continuesFromRail, onRail)
            .overlay(alignment: .topTrailing) {
                if !onRail, let onSkip {
                    Button("Skip", action: onSkip)
                        .buttonStyle(.glass)
                        .foregroundStyle(.white)
                        .padding()
                }
            }
            #if os(iOS)
            .toolbar {
                if onRail { railItems }
            }
            .toolbar(onRail ? .automatic : .hidden, for: .navigationBar)
            #endif
            .sensoryFeedback(.impact, trigger: continueTapCount)
    }

    #if os(iOS)
    @ToolbarContentBuilder private var railItems: some ToolbarContent {
        if step > 0 {
            ToolbarItem(placement: .navigation) {
                Button("Back", systemImage: "chevron.left", action: onBack)
            }
        }
        // Not `.topBarPinnedTrailing`: alone on the closed rail, it never shows. The confirmation
        // action is prominent there by itself, an accent circle under Back.
        ToolbarItem(placement: .confirmationAction) {
            Button("Continue", systemImage: "arrow.right") {
                continueTapCount += 1
                onContinue()
            }
        }
        if let onSkip {
            // At the foot, so it reads after Continue rather than between it and Back.
            ToolbarItem(placement: .bottomBar) {
                Button("Skip", systemImage: "forward", action: onSkip)
            }
        }
    }
    #endif
}

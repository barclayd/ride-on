import SwiftUI
import Models
import Services
import DesignSystem

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

    static let stepCount = 9

    public init() {}

    public var body: some View {
        @Bindable var preferencesStore = preferencesStore

        Group {
            switch step {
            case 0:
                WelcomeStep(pageIndex: 0, pageCount: Self.stepCount, onContinue: advance)
            case 1:
                TemperatureDialStep(range: $preferencesStore.preferences.preferredTempRangeC, pageIndex: 1, pageCount: Self.stepCount, onContinue: advance)
                    .onboardingSkip(advance)
            case 2:
                SunDialStep(preference: $preferencesStore.preferences.sunPreference, pageIndex: 2, pageCount: Self.stepCount, onContinue: advance)
                    .onboardingSkip(advance)
            case 3:
                RainDialStep(tolerance: $preferencesStore.preferences.rainTolerance, pageIndex: 3, pageCount: Self.stepCount, onContinue: advance)
                    .onboardingSkip(advance)
            case 4:
                WindDialStep(maxWindKph: $preferencesStore.preferences.maxWindKph, pageIndex: 4, pageCount: Self.stepCount, onContinue: advance)
                    .onboardingSkip(advance)
            case 5:
                NoveltyDialStep(noveltyDial: $preferencesStore.preferences.noveltyDial, pageIndex: 5, pageCount: Self.stepCount, onContinue: advance)
                    .onboardingSkip(advance)
            case 6:
                StravaConnectStep(
                    isConnected: isStravaConnected,
                    isConnecting: isConnectingStrava,
                    pageIndex: 6,
                    pageCount: Self.stepCount,
                    onConnect: connectStrava,
                    onContinue: advance
                )
                .onboardingSkip(advance)
            case 7:
                SpeedPrefillStep(
                    speedKphBySurface: preferencesStore.preferences.speedKphBySurface,
                    isStravaConnected: isStravaConnected,
                    pageIndex: 7,
                    pageCount: Self.stepCount,
                    onContinue: advance
                )
                .onboardingSkip(advance)
            default:
                FinishStep(pageIndex: 8, pageCount: Self.stepCount, onContinue: finish)
                    .onboardingSkip(finish)
            }
        }
        .transition(.asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        ))
        .animation(reduceMotion ? nil : Motion.onboardingPageTransition, value: step)
    }

    private func advance() {
        step = min(step + 1, Self.stepCount - 1)
    }

    private func connectStrava() {
        isConnectingStrava = true
        Task {
            _ = try? await services.strava.exchangeToken(code: "fixture-auth-code")
            let routes = (try? await services.strava.importedRoutes()) ?? []
            isConnectingStrava = false
            isStravaConnected = true
            if !routes.isEmpty {
                // ponytail: real per-surface speed derivation from 3 months of
                // Strava activity streams is Phase 6 (PLAN.md). This preset
                // just makes the prefill UX real end-to-end today — swap for
                // `SpeedModel`-derived values once the activity fetch lands.
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

/// Skip affordance shared by every step but welcome — a plain system
/// `.glass` button (free Reduce Transparency fallback, DESIGN-SYSTEM.md §1.2)
/// floating top-trailing over the step's ambiance.
extension View {
    func onboardingSkip(_ action: @escaping () -> Void) -> some View {
        overlay(alignment: .topTrailing) {
            Button("Skip", action: action)
                .buttonStyle(.glass)
                .foregroundStyle(.white)
                .padding()
        }
    }
}

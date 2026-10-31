import SwiftUI
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 6: the onboarding preference-screen
/// scaffold, reused verbatim as a You-tab settings editor for the same
/// preference ("onboarding is the settings", §9). Large title, one-sentence
/// body, one control, a `Continue`/save CTA, optional onboarding page dots,
/// a live `AmbianceStyle` background.
///
/// Side by side in landscape (`PaneShape.wide` and `.tent`): the question leading, the control and
/// the CTA trailing. When `continuesFromRail` is set, the iPhone Duo's rail carries Continue, so
/// the screen drops its own CTA.
public struct DialScreen<Control: View>: View {
    public var title: String
    public var bodyText: String
    public var sky: SkyCondition
    public var ctaTitle: String
    public var pageIndex: Int?
    public var pageCount: Int?
    @ViewBuilder public var control: Control
    public var onContinue: () -> Void
    @State private var continueTapCount = 0
    @Environment(\.paneShape) private var paneShape
    @Environment(\.continuesFromRail) private var continuesFromRail

    public init(
        title: String,
        bodyText: String,
        sky: SkyCondition,
        ctaTitle: String = "Continue",
        pageIndex: Int? = nil,
        pageCount: Int? = nil,
        @ViewBuilder control: () -> Control,
        onContinue: @escaping () -> Void
    ) {
        self.title = title
        self.bodyText = bodyText
        self.sky = sky
        self.ctaTitle = ctaTitle
        self.pageIndex = pageIndex
        self.pageCount = pageCount
        self.control = control()
        self.onContinue = onContinue
    }

    private var resolvedSky: SkyCondition {
        AmbianceStyle.resolvedCondition(sky: sky, date: .now)
    }

    public var body: some View {
        ZStack {
            AmbianceBackground(sky: sky)
                .ignoresSafeArea()

            // Legibility scrim for the white title/body/control text below —
            // see `SkyCondition.legibilityScrimOpacity`.
            Color.black
                .opacity(resolvedSky.legibilityScrimOpacity)
                .ignoresSafeArea()

            switch paneShape {
            case .wide?, .tent?: sideBySide
            default: column
            }
        }
        .foregroundStyle(.white)
        // Tick when the reactive sky band flips — one haptic for every dial
        // control (sliders, segmented pickers) since they all drive `sky`.
        .sensoryFeedback(.selection, trigger: sky)
        .sensoryFeedback(.impact, trigger: continueTapCount)
    }

    /// One column: portrait, the closed iPhone Duo, the Mac.
    private var column: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 8) {
                Text(title)
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                Text(bodyText)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)

            control
                // Cap the control width so sliders don't span the whole
                // window on macOS; no-op on iPhone widths.
                .frame(maxWidth: 480)
                .padding(.horizontal)

            Spacer()

            pageDots

            if !continuesFromRail {
                continueButton
            }
        }
        .padding(.bottom, 32)
    }

    /// Landscape: the question leading, what answers it trailing (the canvas's onboarding, open).
    private var sideBySide: some View {
        let wide = paneShape == .wide
        return HStack(spacing: wide ? 72 : 32) {
            VStack(alignment: .leading, spacing: 8) {
                pageDots
                    .padding(.bottom, 6)
                Text(title)
                    .font(.largeTitle.bold())
                Text(bodyText)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 24) {
                control
                    .frame(maxWidth: 480)
                if !continuesFromRail {
                    continueButton
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, wide ? 48 : 24)
        .padding(.vertical, 24)
    }

    @ViewBuilder private var pageDots: some View {
        if let pageIndex, let pageCount, pageCount > 1 {
            HStack(spacing: 6) {
                ForEach(0..<pageCount, id: \.self) { index in
                    Circle()
                        // White like the rest of the screen — primary/
                        // secondary go invisible on dark ambiances.
                        .fill(.white.opacity(index == pageIndex ? 1 : 0.3))
                        .frame(width: 6, height: 6)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Step \(pageIndex + 1) of \(pageCount)")
        }
    }

    private var continueButton: some View {
        Button(ctaTitle) {
            continueTapCount += 1
            onContinue()
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .keyboardShortcut(.defaultAction)
    }
}

public extension EnvironmentValues {
    /// Set where the iPhone Duo's rail carries Continue, so `DialScreen` leaves its own CTA out.
    @Entry var continuesFromRail = false
}

#Preview {
    DialScreen(
        title: "Rain or Shine?",
        bodyText: "How much rain are you willing to ride through?",
        sky: .rain,
        pageIndex: 3,
        pageCount: 9
    ) {
        Slider(value: .constant(0.4))
            .padding(.horizontal, 40)
    } onContinue: {}
}

import SwiftUI
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 6: the onboarding preference-screen
/// scaffold, reused verbatim as a You-tab settings editor for the same
/// preference ("onboarding is the settings", §9). Large title, one-sentence
/// body, one control, a `Continue`/save CTA, optional onboarding page dots,
/// a live `AmbianceStyle` background.
public struct DialScreen<Control: View>: View {
    public var title: String
    public var bodyText: String
    public var sky: SkyCondition
    public var ctaTitle: String
    public var pageIndex: Int?
    public var pageCount: Int?
    @ViewBuilder public var control: Control
    public var onContinue: () -> Void

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
                }

                Button(ctaTitle, action: onContinue)
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.bottom, 32)
        }
        .foregroundStyle(.white)
    }
}

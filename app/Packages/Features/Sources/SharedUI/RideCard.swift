import SwiftUI
import Models
import DesignSystem
import Services

/// DESIGN-SYSTEM.md §6 component 1: the full-bleed Today card — map
/// thumbnail (route polyline, POI-free) under an `AmbianceStyle` wash +
/// bottom scrim, route name, `ConditionChipRow`. Paging between cards is the
/// caller's job (a `TabView(.page)`); this view only owns the swipe-up ->
/// breakdown-sheet gesture and the zoom-transition source.
public struct RideCard: View {
    public var routeID: UUID
    public var routeName: String
    public var coordinates: [Coordinate]
    public var chips: [ConditionChipData]
    public var sky: SkyCondition
    public var date: Date
    public var onSwipeUpForDetails: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var thumbnail: PlatformImage?

    public init(
        routeID: UUID,
        routeName: String,
        coordinates: [Coordinate],
        chips: [ConditionChipData],
        sky: SkyCondition,
        date: Date = .now,
        onSwipeUpForDetails: @escaping () -> Void
    ) {
        self.routeID = routeID
        self.routeName = routeName
        self.coordinates = coordinates
        self.chips = chips
        self.sky = sky
        self.date = date
        self.onSwipeUpForDetails = onSwipeUpForDetails
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            mapLayer

                AmbianceBackground(sky: sky, date: date)
                    .opacity(0.4)
                    .blendMode(.overlay)

                LinearGradient(
                    colors: [.black.opacity(0), .black.opacity(0.45)],
                    startPoint: .center,
                    endPoint: .bottom
                )

                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "chevron.up")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.white.opacity(0.8))
                        .accessibilityHidden(true)

                    Text(routeName)
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)

                    ConditionChipRow(chips: chips)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .clipShape(.rect(cornerRadius: CornerRadius.card))
        .contentShape(.rect(cornerRadius: CornerRadius.card))
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    if value.translation.height < -40 {
                        onSwipeUpForDetails()
                    }
                }
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySentence)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Swipe up for the full breakdown")
        .accessibilityIdentifier("today-card")
        .task(id: routeID) {
            thumbnail = await RouteSnapshotService.snapshot(
                routeID: routeID,
                coordinates: coordinates,
                size: CGSize(width: 800, height: 800),
                colorScheme: colorScheme
            )
        }
    }

    // ponytail: `.scaledToFill()` reports an aspect-corrected *ideal* size
    // that can be larger than what's proposed (that's the whole point — it
    // overflows so there's no letterboxing) — without pinning it back down
    // via `GeometryReader` + `.frame` + `.clipped()`, that oversized ideal
    // size propagates up through the ZStack and inflates the whole card
    // (and everything overlaid on it) past the screen edges.
    @ViewBuilder
    private var mapLayer: some View {
        GeometryReader { proxy in
            Group {
                if let thumbnail {
                    Image(platformImage: thumbnail).resizable().scaledToFill()
                } else {
                    Rectangle().fill(.secondary.opacity(0.2))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
    }
    // ponytail: thumbnail load lives in `.task`, not the body, so it can be
    // cancelled/rerun per `routeID` without a manual state machine.

    // "read as a sentence" per DESIGN-SYSTEM.md §8's VoiceOver example.
    private var accessibilitySentence: String {
        let chipText = chips.map(\.text).joined(separator: ", ")
        return "\(routeName), recommended. \(chipText)"
    }
}

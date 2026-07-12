import SwiftUI
import Models
import DesignSystem
import Services

/// DESIGN-SYSTEM.md §6 component 1: the full-bleed Today hero card — map
/// thumbnail (route polyline, POI-free) under an `AmbianceStyle` wash +
/// bottom scrim, route name, optional stats line, `ConditionChipRow`, and an
/// optional `ScoreRing` top-trailing. This view owns the zoom-transition
/// source; tap handling is the caller's job.
public struct RideCard: View {
    public var routeID: UUID
    public var routeName: String
    public var coordinates: [Coordinate]
    public var chips: [ConditionChipData]
    public var sky: SkyCondition
    public var date: Date
    /// 0...1 (`RankedRide.score`); nil hides the ring.
    public var score: Double?
    /// e.g. "42 km · 380 m · ~2h 10m"; nil hides the line.
    public var stats: String?

    @Environment(\.colorScheme) private var colorScheme
    @State private var thumbnail: PlatformImage?

    public init(
        routeID: UUID,
        routeName: String,
        coordinates: [Coordinate],
        chips: [ConditionChipData],
        sky: SkyCondition,
        date: Date = .now,
        score: Double? = nil,
        stats: String? = nil
    ) {
        self.routeID = routeID
        self.routeName = routeName
        self.coordinates = coordinates
        self.chips = chips
        self.sky = sky
        self.date = date
        self.score = score
        self.stats = stats
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
                    Text(routeName)
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)

                    if let stats {
                        Text(stats)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white.opacity(0.85))
                    }

                    ConditionChipRow(chips: chips)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .topTrailing) {
            if let score {
                ScoreRing(score: score, size: 52)
                    .padding(6)
                    .background(.thinMaterial, in: .circle)
                    .padding(12)
            }
        }
        .clipShape(.rect(cornerRadius: CornerRadius.card))
        .contentShape(.rect(cornerRadius: CornerRadius.card))
        // ponytail: no swipe-up shortcut — the card lives in a vertical
        // ScrollView, where an upward drag IS a scroll (the scroll pan owns
        // the gesture on iOS 26; even simultaneous drags get nothing). Tap
        // opens the breakdown, matching Maps/App Store scroll-embedded cards.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySentence)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Shows the full ride breakdown")
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
        let scoreText = score.map { "Score \(Int(($0 * 100).rounded())) out of 100. " } ?? ""
        return "\(routeName), recommended. \(scoreText)\(chipText)"
    }
}

#Preview {
    RideCard(
        routeID: UUID(),
        routeName: "South Downs Loop",
        coordinates: [
            Coordinate(latitude: 51.75, longitude: -0.80),
            Coordinate(latitude: 51.76, longitude: -0.79),
            Coordinate(latitude: 51.77, longitude: -0.81),
        ],
        chips: [ConditionChipData(symbol: "wind", text: "12 km/h wind", tint: .teal)],
        sky: .sunny
    )
    .frame(height: 480)
    .padding()
}

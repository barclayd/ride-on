import SwiftUI
import Domain
import DesignSystem
import SharedUI

/// How a shortlisted route is faring on Rides, shown in the card's pill.
enum ShortlistStatus: Hashable {
    /// Rides' best pick, on this weekday ("Wed").
    case best(day: String)
    /// Ranked for this start ("Thu 09:00").
    case ranked(start: String)
    case belowMinimums
    /// Longer than the ride window allows.
    case tooLong
    /// Not ranked yet.
    case checking

    var text: String {
        switch self {
        case .best(let day): "Best pick · \(day)"
        case .ranked(let start): start
        case .belowMinimums: "Below your minimums"
        case .tooLong: "Too long for your window"
        case .checking: "Checking the forecast…"
        }
    }

    var fill: Color {
        switch self {
        case .best: .pickPill
        case .ranked: .white
        case .belowMinimums: .belowMinimumsPill
        case .tooLong, .checking: .black.opacity(0.5)
        }
    }

    var foreground: Color {
        switch self {
        case .ranked, .belowMinimums: .black
        case .best, .tooLong, .checking: .white
        }
    }
}

/// A shortlisted route in the Routes panel's carousel: its loop on the cycle map (satellite imagery
/// on the Mac), how it's faring on Rides, and its score when it's ranked. Tapping it shows
/// it on the big map; the check takes it off the shortlist.
struct ShortlistCard: View {
    var route: RouteLibrary.Route
    var status: ShortlistStatus
    var score: Int?
    var isSelected: Bool
    var select: () -> Void
    var remove: () -> Void

    @Environment(\.unitSystem) private var unitSystem
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .title3) private var height: CGFloat = 158

    var body: some View {
        let distance = UnitFormat.distance(km: route.distanceKm, system: unitSystem, fractionDigits: 0)
        let climb = UnitFormat.elevation(m: route.ascentM, system: unitSystem)
        Button(action: select) {
            VStack(alignment: .leading, spacing: 0) {
                pill
                Spacer(minLength: 0)
                footer(distance: distance, climb: climb)
            }
            .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
            // At accessibility sizes the card takes the carousel's width, less a peek of the next.
            .containerRelativeFrame(.horizontal) { width, _ in
                dynamicTypeSize.isAccessibilitySize ? width - 24 : 272
            }
            .background {
                RouteMap(route.coordinates, style: .card)
                    .id(route.id)
                    .allowsHitTesting(false)
            }
            .clipShape(.rect(cornerRadius: CornerRadius.card))
            .contentShape(.rect(cornerRadius: CornerRadius.card))
        }
        .buttonStyle(PressableCardStyle())
        .accessibilityLabel("\(route.name), \(status.text), \(distance), \(climb) climbing\(score.map { ", score \($0)" } ?? "")")
        .accessibilityHint("Shows it on the map")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .overlay(alignment: .topTrailing) { removeButton }
        .overlay {
            if isSelected {
                RoundedRectangle(cornerRadius: CornerRadius.card + 5)
                    .strokeBorder(.tint, lineWidth: 3)
                    .padding(-5)
                    .allowsHitTesting(false)
            }
        }
    }

    private var pill: some View {
        Text(status.text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(status.foreground)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
            .padding(.vertical, 3)
            .padding(.horizontal, 9)
            .background(status.fill, in: .capsule)
            .padding(.top, 12)
            .padding(.leading, 12)
            // Clear of the remove button.
            .padding(.trailing, 52)
    }

    /// Name, stats and score; at accessibility sizes they stack, as on `RideHero` (§8). Under them, a
    /// cycle-map snapshot's attribution, 10pt clear (§2).
    private func footer(distance: String, climb: String) -> some View {
        let large = dynamicTypeSize.isAccessibilitySize
        let layout = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(alignment: .lastTextBaseline, spacing: 8))
        let stats = large ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(spacing: 11))
        return VStack(alignment: .leading, spacing: 10) {
            layout {
                VStack(alignment: .leading, spacing: 1) {
                    Text(route.name)
                        .font(.title3.bold())
                        .lineLimit(large ? 2 : 1)
                    stats {
                        Label(distance, systemImage: "arrow.left.and.right")
                        Label(climb, systemImage: "mountain.2")
                    }
                    .labelStyle(StatLabelStyle())
                    .font(.footnote.weight(.semibold))
                    .opacity(0.92)
                }
                if !large { Spacer(minLength: 0) }
                if let score {
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text(score, format: .number)
                            .font(.title.bold())
                        Text("/100")
                            .font(.caption.weight(.semibold))
                            .opacity(0.72)
                    }
                }
            }
            #if os(iOS)
            if RouteMap.showsCycleMap { CycleMapAttribution(.card) }
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .monospacedDigit()
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
        .padding(.horizontal, 14)
        // On MapKit, clear of the Maps logo and Legal link along the card's bottom edge (§2).
        .padding(.bottom, RouteMap.showsCycleMap ? 4 : 30)
        .padding(.top, 44)
        // Eased stops, so the scrim has no visible top edge (as on `RideHero`).
        .background(LinearGradient(stops: [0, 0.03, 0.1, 0.2, 0.33, 0.45, 0.55, 0.63, 0.7, 0.76, 0.8].enumerated().map {
            .init(color: .black.opacity($1), location: Double($0) / 10)
        }, startPoint: .top, endPoint: .bottom))
    }

    private var removeButton: some View {
        Button(action: remove) {
            Image(systemName: "checkmark")
                .font(.footnote.weight(.heavy))
                .foregroundStyle(.tint)
                .frame(width: 28, height: 28)
                .background(.white, in: .circle)
                .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .padding(2)
        .accessibilityLabel("Remove \(route.name) from Shortlist")
    }
}

/// Gives on press, so the card answers the finger before the tap lands.
private struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.glassTapLayout, value: configuration.isPressed)
    }
}

/// A stat with its symbol, 4pt apart like the canvas.
private struct StatLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}

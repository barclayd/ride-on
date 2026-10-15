import SwiftUI
import Models
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 1: a ride shown full-bleed on its route's map, with the title
/// block over a bottom scrim. At least `height` tall, taller when large text needs the room. The
/// caller places it under the status bar and toolbar, and overlays anything tappable (the commit
/// star on Rides) bottom trailing, clear of the title's trailing 84pt. The date and times live in
/// the caller's card below, not on the map.
public struct RideHero: View {
    var pick: RideBoard.Pick
    /// "Best pick", shown in an accent pill above the name; `nil` shows no pill.
    var eyebrow: String?
    var height: CGFloat

    @Environment(\.unitSystem) private var unitSystem

    public init(pick: RideBoard.Pick, eyebrow: String?, height: CGFloat = 480) {
        self.pick = pick
        self.eyebrow = eyebrow
        self.height = height
    }

    public var body: some View {
        titleBlock
            .padding(.leading, 20)
            .padding(.trailing, 84)
            .padding(.bottom, 36)
            .padding(.top, 120)
            .frame(maxWidth: .infinity, minHeight: 340, alignment: .bottomLeading)
            // Sized by the title block, so large text stays on the scrim (§8 contrast). Eased
            // stops, so the scrim has no visible top edge.
            .background(LinearGradient(stops: [0, 0.03, 0.1, 0.2, 0.33, 0.45, 0.55, 0.63, 0.7, 0.76, 0.8].enumerated().map {
                .init(color: .black.opacity($1), location: Double($0) / 10)
            }, startPoint: .top, endPoint: .bottom))
            .frame(maxWidth: .infinity, minHeight: height, alignment: .bottom)
            .background {
                // Art, not a control: taps belong to whatever the hero opens (Rides links it to
                // Ride detail). The Maps attribution stays visible, just not tappable.
                RouteMap(pick.route.coordinates, style: .hero, tint: pick.meetsMinimums ? .accentColor : .gray)
                    .id(pick.route.id)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .top) {
                // Dims under the status bar and toolbar so their glyphs stay legible (§2).
                LinearGradient(colors: [.black.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: 150)
                    .allowsHitTesting(false)
            }
    }

    private var titleBlock: some View {
        let date = pick.start.formatted(.dateTime.weekday(.wide).day().month(.wide))
        let start = pick.start.formatted(.clockTime)
        let finish = pick.finish.formatted(.clockTime)
        let distance = UnitFormat.distance(km: pick.route.distanceKm, system: unitSystem, fractionDigits: 0)
        let climb = UnitFormat.elevation(m: pick.route.ascentM, system: unitSystem)

        return VStack(alignment: .leading, spacing: 4) {
            if let eyebrow {
                Text(eyebrow)
                    .font(.footnote.weight(.semibold))
                    .padding(.vertical, 3)
                    .padding(.horizontal, 9)
                    .background(pick.meetsMinimums ? Color.pickPill : Color.gray.mix(with: .black, by: 0.18), in: .capsule)
                    .padding(.bottom, 2)
            }
            Text(pick.route.name)
                .font(.largeTitle.bold())
            FlowLayout(spacing: 14) {
                Label(distance, systemImage: "arrow.left.and.right")
                Label("\(climb) climb", systemImage: "mountain.2")
            }
            .labelStyle(StatLabelStyle())
            .font(.subheadline)
            .monospacedDigit()
            .foregroundStyle(.white.opacity(0.88))
        }
        .foregroundStyle(.white)
        .shadow(color: .black.opacity(0.35), radius: 1, y: 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(pick.route.name), \(eyebrow.map { "\($0), " } ?? "")\(date), \(start) to about \(finish), \(distance), \(climb) climbing, score \(pick.score)")
    }
}

/// A stat with its symbol, 5pt apart like the canvas.
private struct StatLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon
            configuration.title
        }
    }
}

#Preview {
    RideHero(pick: RideBoard.sample.picks[0], eyebrow: "Best pick")
        .ignoresSafeArea()
}

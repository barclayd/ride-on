import SwiftUI
import Models

/// DESIGN-SYSTEM.md §6 component 1: a ride shown full-bleed on its route's map, with the title
/// block over a bottom scrim. At least `height` tall, taller when large text needs the room. The
/// caller places it under the status bar and toolbar, and overlays anything tappable (the share
/// button on Rides) bottom trailing, clear of the title's trailing 84pt.
public struct RideHero: View {
    var pick: RideBoard.Pick
    /// "Best pick", shown with a star before the date; `nil` shows the date alone.
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
            .frame(maxWidth: .infinity, alignment: .leading)
            // Sized by the title block, so large text stays on the scrim (§8 contrast).
            .background(LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom))
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

        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                if let eyebrow {
                    Image(systemName: "star.fill")
                    Text("\(eyebrow) · \(date)")
                } else {
                    Text(date)
                }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white.opacity(0.85))
            Text(pick.route.name)
                .font(.largeTitle.bold())
            Text("\(start) → ~\(finish) · \(distance) · \(climb)")
                .monospacedDigit()
        }
        .foregroundStyle(.white)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(pick.route.name), \(eyebrow.map { "\($0), " } ?? "")\(date), \(start) to about \(finish), \(distance), \(climb) climbing, score \(pick.score)")
    }
}

#Preview {
    RideHero(pick: RideBoard.sample.picks[0], eyebrow: "Best pick")
        .ignoresSafeArea()
}

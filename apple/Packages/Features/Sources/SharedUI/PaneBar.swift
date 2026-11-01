import SwiftUI
import DesignSystem

/// DESIGN-SYSTEM.md §6 component 19: the leading pane's own bar on an open iPhone Duo. The rail
/// belongs to the trailing pane, so controls that act on the leading pane sit here, at its top:
/// its large title, then its buttons as 44pt glass circles. Each button needs a title and a
/// symbol, like a rail item; only the symbol shows.
public struct PaneBar<Actions: View>: View {
    var title: String
    var actions: Actions

    public init(_ title: String, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.actions = actions()
    }

    public var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.largeTitle.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            actions
                .labelStyle(.iconOnly)
                .buttonStyle(PaneBarButtonStyle())
                // A menu ("+" on Routes) takes the same circle.
                .menuStyle(.button)
                .menuIndicator(.hidden)
        }
        .padding(.top, 10)
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .padding(.bottom, 8)
    }
}

/// A 44pt glass circle: chrome, so glass (§2), regular and interactive.
private struct PaneBarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title3.weight(.medium))
            .foregroundStyle(.tint)
            .frame(width: 44, height: 44)
            .contentShape(.circle)
            .accessibleGlass(.regular.interactive(), in: .circle, fallback: .groupedBackground)
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .accessibilityShowsLargeContentViewer()
    }
}

#Preview {
    PaneBar("Rides") {
        Button("Ride Window", systemImage: "calendar") {}
        Button("Track a Route", systemImage: "plus") {}
    }
}

import SwiftUI

/// The white dot ringed in the tint under its callout, for `CycleMap.Pin` (and `Annotation` on the Mac).
public struct RoutePin: View {
    var label: String

    public init(_ label: String) {
        self.label = label
    }

    /// From the bottom of the view to the dot's centre, which sits on the point.
    public static let anchor: CGFloat = 8

    public var body: some View {
        VStack(spacing: 6) {
            Text(label)
                .font(.footnote.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.black)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.white, in: .rect(cornerRadius: 12))
                .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
            Circle()
                .fill(.white)
                .frame(width: 10, height: 10)
                .padding(3)
                .background(.tint, in: .circle)
                .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
        }
        .fixedSize()
        // Chrome over the map, held at a fixed size and in the map's light scheme.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .environment(\.colorScheme, .light)
        .accessibilityHidden(true)
    }
}

import SwiftUI
import Domain

/// DESIGN-SYSTEM.md §6 component 4: Ride detail's start time, as tiles of day, time and score.
/// Like `DayStrip`, one `Button` per tile with the selected trait, so VoiceOver reads a set of
/// choices. Tiles stack at accessibility sizes.
public struct DeparturePicker: View {
    var departures: [RideDetail.Departure]
    @Binding var selection: Date
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public init(departures: [RideDetail.Departure], selection: Binding<Date>) {
        self.departures = departures
        self._selection = selection
    }

    public var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            ForEach(departures) { departure in
                tile(departure)
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func tile(_ departure: RideDetail.Departure) -> some View {
        let isSelected = departure.id == selection
        let day = departure.start.formatted(.dateTime.weekday(.abbreviated).day())
        let time = departure.start.formatted(.clockTime)
        let accent = isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary)
        return Button {
            withAnimation(.smooth) { selection = departure.id }
        } label: {
            VStack(spacing: 2) {
                Text(day).font(.caption.weight(.semibold)).foregroundStyle(accent)
                Text(time).font(.title3.bold())
                Text(departure.score, format: .number).font(.caption.weight(.semibold)).foregroundStyle(accent)
            }
            .monospacedDigit()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(isSelected ? AnyShapeStyle(.tint.opacity(0.15)) : AnyShapeStyle(.cardBackground), in: .rect(cornerRadius: 16))
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(departure.start.formatted(.dateTime.weekday(.wide).day().month(.wide))), \(time)")
        .accessibilityValue("Scores \(departure.score)")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

#Preview {
    @Previewable @State var selection = RideDetail.sample(for: RideBoard.sample.picks[0], on: .sample).departures[0].id
    DeparturePicker(departures: RideDetail.sample(for: RideBoard.sample.picks[0], on: .sample).departures, selection: $selection)
        .padding()
        .background(.groupedBackground)
}

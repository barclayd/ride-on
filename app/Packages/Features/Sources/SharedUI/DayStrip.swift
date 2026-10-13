import SwiftUI
import Models

/// DESIGN-SYSTEM.md §6 component 3: one column per day in the window, bar height tracking that
/// day's best score. Days with a ride are buttons that select the day; a rained-off day shows
/// its sky and a stub and can't be selected.
public struct DayStrip: View {
    var days: [RideBoard.Day]
    @Binding var selection: Date

    public init(days: [RideBoard.Day], selection: Binding<Date>) {
        self.days = days
        self._selection = selection
    }

    public var body: some View {
        HStack(spacing: 4) {
            ForEach(days) { day in
                if let best = day.best {
                    rideDay(day, best: best)
                } else {
                    noRideDay(day)
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .sensoryFeedback(.selection, trigger: selection)
    }

    private func rideDay(_ day: RideBoard.Day, best: RideBoard.Pick) -> some View {
        let isSelected = day.date == selection
        return Button {
            withAnimation(.smooth) { selection = day.date }
        } label: {
            column(day) {
                Text(best.score, format: .number)
                    .font(.subheadline.weight(isSelected ? .bold : .semibold))
                    .foregroundStyle(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                    .monospacedDigit()
                RoundedRectangle(cornerRadius: 7)
                    .fill(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                    .frame(width: 26, height: CGFloat(best.score) * 0.7)
            }
            .background(.tint.opacity(isSelected ? 0.15 : 0), in: .rect(cornerRadius: 14))
            .contentShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(day.date.formatted(.dateTime.weekday(.wide)))
        .accessibilityValue("Best ride scores \(best.score)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func noRideDay(_ day: RideBoard.Day) -> some View {
        column(day) {
            Image(systemName: day.sky.systemImage)
                .font(.title3)
                .foregroundStyle(day.sky == .rain ? AnyShapeStyle(.rain) : AnyShapeStyle(.secondary))
            Capsule()
                .fill(.tertiary)
                .frame(width: 26, height: 4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(day.date.formatted(.dateTime.weekday(.wide))), no ride, \(day.sky.title)")
    }

    private func column(_ day: RideBoard.Day, @ViewBuilder top: () -> some View) -> some View {
        VStack(spacing: 6) {
            Spacer(minLength: 0)
            top()
            Text(day.date.formatted(.dateTime.weekday(.abbreviated)))
                .font(.footnote.weight(.semibold))
                // Five columns can't fit "Wed" at accessibility sizes; shrink rather than break it.
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .foregroundStyle(day.best == nil ? .secondary : .primary)
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    @Previewable @State var selection = RideBoard.sample.days[0].date
    DayStrip(days: RideBoard.sample.days, selection: $selection)
        .padding()
}

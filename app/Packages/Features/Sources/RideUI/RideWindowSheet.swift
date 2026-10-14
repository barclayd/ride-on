import SwiftUI
import Models
import DesignSystem
import SharedUI

/// The Ride Window sheet (docs/redesign/README.md §3): which days to plan and the hours to ride in.
/// Done hands the window to `apply`, which reloads Rides; Cancel drops the changes.
public struct RideWindowSheet: View {
    var board: RideBoard
    var apply: @MainActor @Sendable (RideWindow) async -> Void
    @State private var selection: Set<Date>
    @State private var custom: Bool
    @State private var leave: Date
    @State private var back: Date
    @State private var applying = false
    @Environment(\.dismiss) private var dismiss

    public init(board: RideBoard, apply: @escaping @MainActor @Sendable (RideWindow) async -> Void) {
        self.board = board
        self.apply = apply
        _selection = State(initialValue: Set(board.days.map(\.date)))
        let (leave, back) = switch board.hours {
        case .daylight: (8 * 60, 17 * 60)
        case .custom(let leave, let back): (leave, back)
        }
        _custom = State(initialValue: board.hours != .daylight)
        _leave = State(initialValue: Self.time(leave))
        _back = State(initialValue: Self.time(back))
    }

    /// Every forecast day, chosen or not.
    private var days: [RideBoard.Day] { board.forecast.isEmpty ? board.days : board.forecast }

    /// The forecast's first day is the API's today.
    private var today: Date { days.first?.date ?? .now }

    /// The best ride across the chosen days: one that meets the minimums first, then the highest score.
    private var bestPick: RideBoard.Pick? {
        days.filter { selection.contains($0.date) }.compactMap(\.best)
            .max { ($0.meetsMinimums ? 1 : 0, $0.score) < ($1.meetsMinimums ? 1 : 0, $1.score) }
    }

    private var quickPick: RideWindow.QuickPick? {
        Self.quickPicks.first { Set($0.days(from: today)) == selection }
    }

    private var hours: RideWindow.Hours {
        custom ? .custom(leave: Self.minutes(leave), back: Self.minutes(back)) : .daylight
    }

    private var hoursValid: Bool { !custom || Self.minutes(leave) < Self.minutes(back) }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    FlowLayout {
                        ForEach(Self.quickPicks, id: \.self, content: quickPickButton)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                Section {
                    ForEach(days) { day in dayRow(day) }
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                } header: {
                    Text("Days")
                } footer: {
                    if let last = days.last {
                        Text("Best tracked route each day. Forecast to \(last.date.formatted(Self.dayStyle)).")
                    }
                }

                Section {
                    Picker("Hours", selection: $custom.animation(Motion.glassTapLayout)) {
                        Text("Daylight").tag(false)
                        Text("Custom").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    if custom {
                        DatePicker("Leave After", selection: $leave, displayedComponents: .hourAndMinute)
                        DatePicker("Back By", selection: $back, displayedComponents: .hourAndMinute)
                    } else {
                        let daylight = (days.first { selection.contains($0.date) && $0.daylight != nil } ?? days.first { $0.daylight != nil })?.daylight
                        LabeledContent("Leave After", value: daylight.map { "Sunrise, about \($0.start.formatted(.clockTime))" } ?? "Sunrise")
                        LabeledContent("Back By", value: daylight.map { "Sunset, about \($0.end.formatted(.clockTime))" } ?? "Sunset")
                    }
                } header: {
                    Text("Hours")
                } footer: {
                    if !hoursValid {
                        Text("Back By must be after Leave After.").foregroundStyle(.red)
                    } else if custom {
                        Text("Rides start and finish between these times, in daylight.")
                    } else {
                        Text("Times follow sunrise and sunset each day. Choose Custom to set your own.")
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Ride Window")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                        .tint(.primary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if applying {
                        ProgressView()
                    } else {
                        Button(role: .confirm) {
                            applying = true
                            Task {
                                await apply(RideWindow(days: selection.sorted(), quickPick: quickPick, hours: hours))
                                dismiss()
                            }
                        }
                        .disabled(selection.isEmpty || !hoursValid)
                    }
                }
            }
        }
        .interactiveDismissDisabled(applying)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Quick picks

    private static let quickPicks: [RideWindow.QuickPick] = [.tomorrow, .weekend, .next]

    private func quickPickButton(_ pick: RideWindow.QuickPick) -> some View {
        let isSelected = pick == quickPick
        return Button {
            withAnimation(Motion.glassTapLayout) { selection = Set(pick.days(from: today)) }
        } label: {
            Text(pick.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isSelected ? AnyShapeStyle(.tint.opacity(0.15)) : AnyShapeStyle(.cardBackground), in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: isSelected) { _, new in new }
    }

    // MARK: Days

    private func dayRow(_ day: RideBoard.Day) -> some View {
        let isSelected = selection.contains(day.date)
        return Button {
            withAnimation(Motion.glassTapLayout) { selection.formSymmetricDifference([day.date]) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .symbolRenderingMode(isSelected ? .palette : .monochrome)
                    .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.tertiary), .tint)
                    .font(.title2)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(day.date == today ? "Today" : day.date.formatted(Self.dayStyle))
                    line(day).font(.footnote)
                }
                Spacer(minLength: 0)
                Image(systemName: day.sky.outlineSymbol)
                    .symbolRenderingMode(.multicolor)
                    .foregroundStyle(day.sky == .rain ? AnyShapeStyle(.rain) : AnyShapeStyle(.secondary))
                    .accessibilityLabel(day.sky.title)
                if let high = day.temperatureMaxC ?? day.best?.conditions.temperatureC.upperBound {
                    Text(UnitFormat.degrees(c: high))
                        .font(.title3)
                        .monospacedDigit()
                        .frame(minWidth: 36, alignment: .trailing)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .sensoryFeedback(.selection, trigger: isSelected)
    }

    @ViewBuilder
    private func line(_ day: RideBoard.Day) -> some View {
        if let best = day.best, best.id == bestPick?.id {
            Text("\(Image(systemName: "star.fill")) Best pick · \(best.route.name) · \(best.score)")
                .fontWeight(.semibold)
                .foregroundStyle(.tint)
        } else {
            let parts = [day.best.map { "\($0.route.name) · \($0.score)" }, day.note,
                         day.forecastEnds.map { "Forecast ends \($0.formatted(.clockTime))" }].compactMap(\.self)
            Text(parts.isEmpty ? "No ride" : parts.joined(separator: " · "))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Time

    /// "Wed 14 Oct".
    private static let dayStyle = Date.FormatStyle.dateTime.weekday(.abbreviated).day().month(.abbreviated)

    private static func time(_ minutes: Int) -> Date {
        Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: .now) ?? .now
    }

    private static func minutes(_ date: Date) -> Int {
        let time = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (time.hour ?? 0) * 60 + (time.minute ?? 0)
    }
}

private extension RideWindow.QuickPick {
    var title: String {
        switch self {
        case .today: "Today"
        case .tomorrow: "Tomorrow"
        case .weekend: "This Weekend"
        case .next: "Next 5 Days"
        }
    }
}

#Preview {
    Text("Rides").sheet(isPresented: .constant(true)) {
        RideWindowSheet(board: .sample) { _ in }
    }
}

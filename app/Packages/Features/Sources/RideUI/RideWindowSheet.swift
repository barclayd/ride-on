import SwiftUI
import Models
import DesignSystem
import SharedUI
import Services

/// What the Ride Window is choosing. Rides keeps it while the window is open, so the choice carries
/// over when the iPhone Duo opens or closes and the sheet becomes a card over the Rides pane, or back.
@MainActor @Observable
final class RideWindowDraft {
    let board: RideBoard
    var selection: Set<Date>
    var custom: Bool
    var leave: Date
    var back: Date
    /// Done is saving the window and reloading Rides.
    var applying = false

    init(board: RideBoard) {
        self.board = board
        selection = Set(board.days.map(\.date))
        let (leave, back) = switch board.hours {
        case .daylight: (8 * 60, 17 * 60)
        case .custom(let leave, let back): (leave, back)
        }
        custom = board.hours != .daylight
        let calendar = Self.calendar(board.timeZone)
        self.leave = Self.time(leave, calendar: calendar)
        self.back = Self.time(back, calendar: calendar)
    }

    /// Every forecast day, chosen or not.
    var days: [RideBoard.Day] {
        let saved = board.forecast.isEmpty ? board.days : board.forecast
        guard !FixtureWorld.isEnabled else { return saved }
        let remaining = saved.filter { $0.date >= today }
        guard remaining.isEmpty else { return remaining }
        // An expired/offline board must still let the rider choose new dates.
        return (0..<7).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: today).map {
                RideBoard.Day(date: $0, best: nil, sky: .cloudy, note: "Refresh to see the forecast")
            }
        }
    }

    var calendar: Calendar { Self.calendar(board.timeZone) }
    var today: Date {
        if FixtureWorld.isEnabled { return (board.forecast.isEmpty ? board.days : board.forecast).first?.date ?? .now }
        return calendar.startOfDay(for: .now)
    }

    /// The best ride across the chosen days: one that meets the minimums first, then the highest score.
    var bestPick: RideBoard.Pick? {
        days.filter { selection.contains($0.date) }.compactMap(\.best)
            .max { ($0.meetsMinimums ? 1 : 0, $0.score) < ($1.meetsMinimums ? 1 : 0, $1.score) }
    }

    var quickPick: RideWindow.QuickPick? {
        Self.quickPicks.first { Set($0.days(from: today, calendar: calendar)) == selection }
    }

    var hours: RideWindow.Hours {
        custom ? .custom(leave: Self.minutes(leave, calendar: calendar), back: Self.minutes(back, calendar: calendar)) : .daylight
    }

    var hoursValid: Bool { !custom || Self.minutes(leave, calendar: calendar) < Self.minutes(back, calendar: calendar) }

    var canApply: Bool { !selection.isEmpty && hoursValid && !applying }

    var window: RideWindow { RideWindow(days: selection.sorted(), quickPick: quickPick, hours: hours) }

    static let quickPicks: [RideWindow.QuickPick] = [.tomorrow, .weekend, .next]

    static func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .current
        return calendar
    }

    private static func time(_ minutes: Int, calendar: Calendar) -> Date {
        calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: .now) ?? .now
    }

    private static func minutes(_ date: Date, calendar: Calendar) -> Int {
        let time = calendar.dateComponents([.hour, .minute], from: date)
        return (time.hour ?? 0) * 60 + (time.minute ?? 0)
    }
}

/// The Ride Window sheet (docs/redesign/README.md §3): which days to plan and the hours to ride in.
/// Done hands the window to `apply`, which reloads Rides; Cancel drops the changes. On the iPhone
/// Duo's rail, Cancel sits at the top and Done under it, the accent circle (DESIGN-SYSTEM.md §5).
public struct RideWindowSheet: View {
    @State private var draft: RideWindowDraft
    var apply: @MainActor @Sendable (RideWindow) async -> Void
    @Environment(\.dismiss) private var dismiss
    #if os(iOS)
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    #endif

    public init(board: RideBoard, apply: @escaping @MainActor @Sendable (RideWindow) async -> Void) {
        self.init(draft: RideWindowDraft(board: board), apply: apply)
    }

    init(draft: RideWindowDraft, apply: @escaping @MainActor @Sendable (RideWindow) async -> Void) {
        _draft = State(initialValue: draft)
        self.apply = apply
    }

    private var onRail: Bool {
        #if os(iOS)
        toolbarVerticalEdge != nil
        #else
        false
        #endif
    }

    public var body: some View {
        NavigationStack {
            RideWindowForm(draft: draft)
                .navigationTitle("Ride Window")
                #if os(iOS)
                // The rail has no title, so it heads the content there.
                .navigationBarTitleDisplayMode(onRail ? .large : .inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(role: .cancel) { dismiss() }
                            .tint(.primary)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        // A custom view never shows on the rail, so there Done stays, dimmed, while it saves.
                        if draft.applying && !onRail {
                            ProgressView()
                        } else {
                            Button(role: .confirm) {
                                draft.applying = true
                                Task {
                                    await apply(draft.window)
                                    dismiss()
                                }
                            }
                            .disabled(!draft.canApply)
                        }
                    }
                }
                .overlay {
                    if draft.applying && onRail {
                        ProgressView().controlSize(.large)
                    }
                }
        }
        .environment(\.timeZone, draft.calendar.timeZone)
        .interactiveDismissDisabled(draft.applying)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// The Ride Window on the open iPhone Duo in landscape: a card over the Rides pane, with the ride
/// beside it left as it was. The rail belongs to that ride, so Cancel and Done sit in the card's
/// own bar (DESIGN-SYSTEM.md §5).
struct RideWindowPane: View {
    var draft: RideWindowDraft
    var apply: @MainActor @Sendable (RideWindow) async -> Void
    var close: () -> Void

    var body: some View {
        RideWindowForm(draft: draft)
            .safeAreaBar(edge: .top) {
                PaneBar("Ride Window") {
                    Button("Cancel", systemImage: "xmark", role: .cancel, action: close)
                    if draft.applying {
                        ProgressView()
                            .frame(width: 44, height: 44)
                    } else {
                        Button("Done", systemImage: "checkmark") {
                            draft.applying = true
                            Task {
                                await apply(draft.window)
                                draft.applying = false
                                close()
                            }
                        }
                        .disabled(!draft.canApply)
                    }
                }
            }
            .environment(\.timeZone, draft.calendar.timeZone)
            .background(.groupedBackground)
            .clipShape(.rect(cornerRadius: CornerRadius.floatingPanel))
            .shadow(color: .black.opacity(0.28), radius: 20, y: 12)
    }
}

/// The Ride Window's quick picks, days and hours, in the sheet or the card over the Rides pane.
struct RideWindowForm: View {
    @Bindable var draft: RideWindowDraft
    @Environment(\.locale) private var locale

    private var days: [RideBoard.Day] { draft.days }
    private var today: Date { draft.today }

    var body: some View {
        Form {
            Section {
                FlowLayout {
                    ForEach(RideWindowDraft.quickPicks, id: \.self, content: quickPickButton)
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
                    Text("Best tracked route each day. Forecast to \(last.date.formatted(dayStyle)).")
                }
            }

            Section {
                Picker("Hours", selection: $draft.custom.animation(Motion.glassTapLayout)) {
                    Text("Daylight").tag(false)
                    Text("Custom").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                if draft.custom {
                    DatePicker("Leave After", selection: $draft.leave, displayedComponents: .hourAndMinute)
                    DatePicker("Back By", selection: $draft.back, displayedComponents: .hourAndMinute)
                } else {
                    let daylight = (days.first { draft.selection.contains($0.date) && $0.daylight != nil } ?? days.first { $0.daylight != nil })?.daylight
                    LabeledContent("Leave After", value: daylight.map { "Sunrise, about \($0.start.formatted(.clockTime))" } ?? "Sunrise")
                    LabeledContent("Back By", value: daylight.map { "Sunset, about \($0.end.formatted(.clockTime))" } ?? "Sunset")
                }
            } header: {
                Text("Hours")
            } footer: {
                if !draft.hoursValid {
                    Text("Back By must be after Leave After.").foregroundStyle(.red)
                } else if draft.custom {
                    Text("Rides start and finish between these times, in daylight.")
                } else {
                    Text("Times follow sunrise and sunset each day. Choose Custom to set your own.")
                }
            }
        }
        .formStyle(.grouped)
    }

    // MARK: Quick picks

    private func quickPickButton(_ pick: RideWindow.QuickPick) -> some View {
        let isSelected = pick == draft.quickPick
        return Button {
            withAnimation(Motion.glassTapLayout) { draft.selection = Set(pick.days(from: today, calendar: draft.calendar)) }
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
        let isSelected = draft.selection.contains(day.date)
        return Button {
            withAnimation(Motion.glassTapLayout) { draft.selection.formSymmetricDifference([day.date]) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .symbolRenderingMode(isSelected ? .palette : .monochrome)
                    .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.tertiary), .tint)
                    .font(.title2)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(day.date == today ? "Today" : day.date.formatted(dayStyle))
                    line(day).font(.footnote)
                }
                Spacer(minLength: 0)
                if day.best != nil {
                    Image(systemName: day.sky.outlineSymbol)
                        .symbolRenderingMode(.multicolor)
                        .foregroundStyle(day.sky == .rain ? AnyShapeStyle(.rain) : AnyShapeStyle(.secondary))
                        .accessibilityLabel(day.sky.title)
                }
                if let high = day.temperatureMaxC ?? day.best?.conditions.temperatureC.upperBound {
                    Text(UnitFormat.degrees(c: high, locale: locale))
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
        if let best = day.best, best.id == draft.bestPick?.id {
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
    private var dayStyle: Date.FormatStyle {
        var style = Date.FormatStyle.dateTime.weekday(.abbreviated).day().month(.abbreviated)
        style.timeZone = draft.calendar.timeZone
        return style
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

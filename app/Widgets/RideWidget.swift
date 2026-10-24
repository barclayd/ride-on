import SwiftUI
import WidgetKit
import AppIntents
import Models
import DesignSystem

@main
struct RideWidgets: WidgetBundle {
    var body: some Widget {
        RideWidget()
        RideControl()
        #if os(iOS)
        RideLiveActivity()
        #endif
    }
}

/// One adaptive widget, no options (docs/redesign/README.md §8): the departure board (A) when
/// nothing's tracked, the tracked ride (D) from the moment it is until two hours after it ends.
struct RideWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "RideWidget", provider: RideProvider()) { entry in
            RideWidgetView(entry: entry)
                .tint(.rideAccent)
                .containerBackground(for: .widget) { Color.cardBackground }
        }
        .configurationDisplayName("Ride On")
        .description("The best ride each day, or the one you're tracking.")
        .supportedFamilies(Self.families)
        .contentMarginsDisabled()
    }

    #if os(iOS)
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge,
                                           .accessoryInline, .accessoryCircular, .accessoryRectangular]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
    #endif
}

struct RideEntry: TimelineEntry {
    var date: Date
    var snapshot: RideWidgetSnapshot?
    /// The day the arrows paged to.
    var paged: Date?
}

struct RideProvider: TimelineProvider {
    /// The sample board, at the time it was ranked so its days are still ahead.
    static let sample = RideWidgetSnapshot(board: .sample, tracked: nil, units: .init(distance: .metric, speed: .metric, temperature: nil))

    func placeholder(in context: Context) -> RideEntry {
        RideEntry(date: Self.sample.generatedAt, snapshot: Self.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (RideEntry) -> Void) {
        completion(WidgetStore.load().map { RideEntry(date: .now, snapshot: $0, paged: Self.paged) } ?? placeholder(in: context))
    }

    /// Redrawn as the ride time and progress move: at the start, every five minutes while riding, at
    /// the finish and when D hands back to A, and at midnight, when a day drops off.
    func getTimeline(in context: Context, completion: @escaping (Timeline<RideEntry>) -> Void) {
        let now = Date.now, snapshot = WidgetStore.load(), paged = Self.paged
        var dates: Set<Date> = [now]
        if let ride = snapshot?.tracked?.ride {
            dates.formUnion(stride(from: ride.start, through: ride.finish, by: 300))
            dates.formUnion([ride.finish, ride.finish.addingTimeInterval(2 * 3600)])
        }
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0), matchingPolicy: .nextTime) {
            dates.insert(midnight)
        }
        let entries = dates.filter { $0 >= now }.sorted().map { RideEntry(date: $0, snapshot: snapshot, paged: paged) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    static var paged: Date? { WidgetStore.defaults.object(forKey: WidgetStore.pagedDayKey) as? Date }
}

/// The arrows and the board's rows: show another day. The app clears it when the board changes.
struct PageDay: AppIntent {
    static let title: LocalizedStringResource = "Show Day"
    static let isDiscoverable = false

    @Parameter(title: "Day") var day: Date

    init() {}

    init(day: Date) {
        self.day = day
    }

    func perform() async throws -> some IntentResult {
        WidgetStore.defaults.set(day, forKey: WidgetStore.pagedDayKey)
        return .result()
    }
}

struct RideWidgetView: View {
    var entry: RideEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let snapshot = entry.snapshot, let tracked = snapshot.trackedRide(at: entry.date) {
            TrackedView(family: family, tracked: tracked, units: snapshot.units, date: entry.date)
        } else if let snapshot = entry.snapshot, let day = snapshot.day(at: entry.date, paged: entry.paged) {
            BoardView(family: family, snapshot: snapshot, day: day, date: entry.date)
        } else {
            EmptyRideView(family: family)
        }
    }
}

/// Signed out, or nothing ranked yet.
struct EmptyRideView: View {
    var family: WidgetFamily

    var body: some View {
        switch family {
        #if os(iOS)
        case .accessoryInline: Text("Ride On")
        case .accessoryCircular: ZStack { AccessoryWidgetBackground(); Image(systemName: "bicycle") }
        case .accessoryRectangular: Text("Open Ride On to see your rides")
        #endif
        default:
            VStack(spacing: 6) {
                Image(systemName: "bicycle").font(.title2).foregroundStyle(.tint)
                Text("Open Ride On to see your rides").font(.footnote.weight(.semibold)).multilineTextAlignment(.center)
            }
            .padding()
            .widgetURL(URL(string: "rideon://ride"))
        }
    }
}

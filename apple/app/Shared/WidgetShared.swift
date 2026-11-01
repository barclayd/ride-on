import Foundation
import AppIntents
import Domain
#if os(iOS)
import ActivityKit
#endif

// Compiled into both the app and the widget extension (docs/redesign/README.md §8).

/// The App Group the app writes and the widget reads: the snapshot, the map stills and the paged day.
enum WidgetStore {
    static let group = "group.com.danbarclay.rideon"
    /// The day the widget's arrows paged to. The app clears it whenever the snapshot changes.
    static let pagedDayKey = "widget.pagedDay"

    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }
    static var directory: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }

    static func load() -> RideWidgetSnapshot? {
        guard let url = directory?.appending(path: "widget.json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(RideWidgetSnapshot.self, from: data)
    }

    static func save(_ snapshot: RideWidgetSnapshot) {
        guard let url = directory?.appending(path: "widget.json"), let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

/// `rideon://ride?pick=<Pick.id>&track=1`: a widget tap opens the Rides tab on that ride, and with
/// `track`, its Track sheet. There's no Directions link anywhere (DESIGN-SYSTEM.md §1).
struct RideLink: Equatable {
    var pick: String
    var track = false

    var url: URL {
        var components = URLComponents()
        components.scheme = "rideon"
        components.host = "ride"
        components.queryItems = [URLQueryItem(name: "pick", value: pick)] + (track ? [URLQueryItem(name: "track", value: "1")] : [])
        return components.url!
    }

    init(pick: String, track: Bool = false) {
        self.pick = pick
        self.track = track
    }

    init?(_ url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard url.scheme == "rideon", url.host() == "ride", let pick = items.first(where: { $0.name == "pick" })?.value else { return nil }
        self.init(pick: pick, track: items.contains { $0.name == "track" && $0.value == "1" })
    }
}

extension Locale {
    /// This locale with its weather temperatures in `unit` (the `mu` keyword); `nil` leaves it as is.
    func temperatureUnit(_ unit: TemperatureUnit?) -> Locale {
        guard let unit else { return self }
        let parts = identifier.split(separator: "@", maxSplits: 1)
        let keywords = (parts.count > 1 ? parts[1].split(separator: ";").filter { !$0.hasPrefix("mu=") }.map(String.init) : [])
            + ["mu=\(unit == .fahrenheit ? "fahrenhe" : "celsius")"]
        return Locale(identifier: "\(parts[0])@\(keywords.joined(separator: ";"))")
    }
}

/// The Control Centre control's tap: the tracked ride, else the best ride's Track sheet. Runs in the
/// app, so it's in both targets.
struct OpenRideIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Ride"
    static let openAppWhenRun = true
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult & OpensIntent {
        let snapshot = WidgetStore.load()
        let link = snapshot?.trackedRide(at: .now).map { RideLink(pick: $0.ride.id) }
            ?? snapshot?.day(at: .now, paged: nil)?.ride.map { RideLink(pick: $0.id, track: true) }
        return .result(opensIntent: OpenURLIntent(link?.url ?? URL(string: "rideon://ride")!))
    }
}

#if os(iOS)
/// The tracked ride's Live Activity: morning of the ride until the finish (docs/redesign/README.md §8).
/// ActivityKit caps attributes and state at 4 KB together, so the loop is thinned to ~30 points
/// and the state drops the ride's loop and hours.
struct RideActivityAttributes: ActivityAttributes {
    typealias ContentState = RideWidgetSnapshot.Tracked
    var loop: [Coordinate]
    var units: RideWidgetSnapshot.Units
}
#endif

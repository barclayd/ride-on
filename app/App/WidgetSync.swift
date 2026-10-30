import SwiftUI
import WidgetKit
import MapKit
import Models
import Services
#if os(iOS)
import ActivityKit
import SharedUI
#endif

/// Keeps the widget, the control and the Live Activity in step with the app (docs/redesign/README.md
/// §8): saves the snapshot to the App Group, renders the map stills it needs, and starts, updates or
/// ends the tracked ride's Live Activity.
@MainActor
enum WidgetSync {
    /// `active`: stills are only rendered while the app is in front, where map tiles can load.
    static func sync(board: RideBoard?, tracked: TrackedRide?, units: RideWidgetSnapshot.Units, active: Bool) async {
        let previous = WidgetStore.load()
        // ponytail: signed out keeps the last snapshot; clear it on sign-out if a stale widget matters.
        guard let board else { return }
        var snapshot = RideWidgetSnapshot(board: board, tracked: tracked, units: units, previous: previous)
        if FixtureWorld.isEnabled { snapshot = snapshot.current() }
        if snapshot != previous {
            WidgetStore.save(snapshot)
            WidgetStore.defaults.removeObject(forKey: WidgetStore.pagedDayKey)
            reload()
        }
        #if os(iOS)
        await syncActivity(snapshot.tracked, units: units)
        #endif
        if active, await renderStills(snapshot) { reload() }
    }

    private static func reload() {
        WidgetCenter.shared.reloadAllTimelines()
        ControlCenter.shared.reloadAllControls()
    }

    // MARK: Map stills

    /// Every day's band and tall stills, and the square for the best and the tracked ride; the rest
    /// pruned. Whether any were rendered.
    private static func renderStills(_ snapshot: RideWidgetSnapshot) async -> Bool {
        guard let directory = WidgetStore.directory else { return false }
        let best = snapshot.days.first { $0.date == snapshot.bestDay }?.ride, tracked = snapshot.tracked?.ride
        var wanted: [String: (url: URL, rect: MKMapRect, shape: WidgetMap.Shape)] = [:]
        for ride in snapshot.days.compactMap(\.ride) + [tracked].compactMap(\.self) {
            for shape in ride == best || ride == tracked ? WidgetMap.Shape.allCases : [.band, .tall] {
                let rect = WidgetMap.framing(ride.loop, shape)
                if !rect.isNull, let url = WidgetMap.url(rect, shape) { wanted[url.lastPathComponent] = (url, rect, shape) }
            }
        }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.lastPathComponent.hasPrefix("map-") && wanted[file.lastPathComponent] == nil {
            try? FileManager.default.removeItem(at: file)
        }
        var rendered = false
        for still in wanted.values where !FileManager.default.fileExists(atPath: still.url.path()) {
            guard let data = await image(still.rect, still.shape) else { continue }
            try? data.write(to: still.url, options: .atomic)
            rendered = true
        }
        return rendered
    }

    /// The map alone, as a JPEG: the cycle map on iOS, Apple's on the Mac (no MapLibre there).
    private static func image(_ rect: MKMapRect, _ shape: WidgetMap.Shape) async -> Data? {
        #if os(iOS)
        await CycleMapStill.image(framing: rect, size: shape.size, scale: 3)?.jpegData(compressionQuality: 0.8)
        #else
        let options = MKMapSnapshotter.Options()
        options.mapRect = rect
        options.size = shape.size
        options.appearance = NSAppearance(named: .aqua)
        options.pointOfInterestFilter = .excludingAll
        guard let snapshot = try? await MKMapSnapshotter(options: options).start(),
              let tiff = snapshot.image.tiffRepresentation else { return nil }
        return NSBitmapImageRep(data: tiff)?.representation(using: .jpeg, properties: [.compressionFactor: 0.8])
        #endif
    }

    // MARK: Live Activity

    #if os(iOS)
    /// One activity for the tracked ride, from the morning of it (three hours before the start) until
    /// the finish; any other ended. It gets no pushes, so it goes stale at the start, where the system
    /// redraws the plan as a countdown, and once the app has seen the ride start, at the finish.
    private static func syncActivity(_ tracked: RideWidgetSnapshot.Tracked?, units: RideWidgetSnapshot.Units) async {
        // The state leaves the loop and hours to the attributes: ActivityKit caps both at 4 KB.
        let state = tracked.map { tracked -> RideWidgetSnapshot.Tracked in
            var state = tracked
            state.ride.loop = []
            state.ride.hours = []
            return state
        }
        let live = state.flatMap { Date.now < $0.ride.finish ? $0 : nil }
        let stale = live.map { Date.now < $0.ride.start ? $0.ride.start : $0.ride.finish }
        for activity in Activity<RideActivityAttributes>.activities {
            if let live, activity.content.state.ride.id == live.ride.id {
                if activity.content.state != live || activity.content.staleDate != stale {
                    await activity.update(ActivityContent(state: live, staleDate: stale))
                }
            } else {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        guard let tracked, let live, ActivityAuthorizationInfo().areActivitiesEnabled,
              !Activity<RideActivityAttributes>.activities.contains(where: { $0.content.state.ride.id == live.ride.id }) else { return }
        let loop = tracked.ride.loop, step = max(1, loop.count / 30)
        let attributes = RideActivityAttributes(loop: stride(from: 0, to: loop.count, by: step).map { loop[$0] }, units: units)
        let content = ActivityContent(state: live, staleDate: stale)
        let morning = live.ride.start.addingTimeInterval(-3 * 3600)
        if morning > .now {
            let alert = AlertConfiguration(title: "\(live.ride.name) today",
                                           body: "\(live.ride.rideTime(at: morning)) · scored \(live.score)", sound: .default)
            _ = try? Activity.request(attributes: attributes, content: content, pushType: nil, style: .standard,
                                      alertConfiguration: alert, start: morning)
        } else {
            _ = try? Activity.request(attributes: attributes, content: content, pushType: nil)
        }
    }
    #endif
}

private extension RideWidgetSnapshot {
    /// The fixture world's sample, pinned to Tuesday 13 October 2026, moved to today: with
    /// `--fixture-now <ISO 8601>`, so that sample instant is now (the morning of a ride, mid-ride).
    func current(calendar: Calendar = .current) -> Self {
        let anchor = ProcessInfo.processInfo.arguments.drop { $0 != "--fixture-now" }.dropFirst().first
            .flatMap { try? Date($0, strategy: .iso8601) }
        let from = anchor ?? generatedAt, now = Date.now
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: from), to: calendar.startOfDay(for: now)).day ?? 0
        // ponytail: whole days keep wall-clock times across DST; the anchor's time-of-day only shifts instants,
        // so a ride moved past midnight shows under the day before. Fine for screenshots.
        let seconds = anchor.map { now.timeIntervalSince(calendar.startOfDay(for: now)) - $0.timeIntervalSince(calendar.startOfDay(for: $0)) } ?? 0
        let day = { calendar.date(byAdding: .day, value: days, to: $0)! }
        let instant = { day($0).addingTimeInterval(seconds) }
        func move(_ ride: Ride) -> Ride {
            var ride = ride
            ride.start = instant(ride.start)
            ride.finish = instant(ride.finish)
            ride.hours = ride.hours.map { var hour = $0; hour.time = instant(hour.time); return hour }
            return ride
        }
        var moved = self
        moved.generatedAt = min(instant(generatedAt), now)
        moved.bestDay = bestDay.map(day)
        moved.days = self.days.map { var d = $0; d.date = day(d.date); d.ride = d.ride.map(move); return d }
        moved.tracked = tracked.map { var t = $0; t.ride = move(t.ride); t.checkedAt = t.checkedAt.map(instant); return t }
        return moved
    }
}

#if os(iOS)
import SwiftUI
import WidgetKit
import ActivityKit
import Models
import DesignSystem

/// The tracked ride's Live Activity and Dynamic Island, in Widgets D's style (docs/redesign/README.md
/// §8): from the morning of the ride until the finish, then "Ride over".
struct RideLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RideActivityAttributes.self) { context in
            LockScreenActivity(context: context)
                .tint(.rideAccent)
                .activityBackgroundTint(Color.cardBackground)
        } dynamicIsland: { context in
            let tracked = context.state, units = context.attributes.units
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(tracked.ride.name, systemImage: "bell.fill").font(.caption.weight(.semibold)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ActivityRideTime(ride: tracked.ride, short: true)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.committed)
                        .lineLimit(1)
                        .padding(.trailing, 8) // clears the expanded island's top corner, which clipped "ride"
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 12) {
                        LoopTile(loop: context.attributes.loop, size: 52)
                        ScoreArc(score: tracked.score, change: tracked.change, warn: tracked.warn, size: 52)
                        Conds(tracked: tracked, units: units, size: 12)
                        Spacer(minLength: 0)
                    }
                }
            } compactLeading: {
                LoopShape(loop: context.attributes.loop)
                    .stroke(Color.rideAccent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                IslandScore(score: tracked.score)
            } minimal: {
                IslandScore(score: tracked.score)
            }
            .widgetURL(RideLink(pick: tracked.ride.id).url)
            .keylineTint(.rideAccent)
        }
    }
}

private struct LockScreenActivity: View {
    var context: ActivityViewContext<RideActivityAttributes>

    var body: some View {
        let tracked = context.state, ride = tracked.ride
        HStack(spacing: 12) {
            LoopTile(loop: context.attributes.loop, size: 64)
            VStack(alignment: .leading, spacing: 6) {
                Label(ride.name, systemImage: "bell.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.committed)
                    .lineLimit(1)
                if Date.now >= ride.finish {
                    Text("Ride over").font(.headline)
                } else {
                    HStack(spacing: 10) {
                        ScoreArc(score: tracked.score, change: tracked.change, warn: tracked.warn, size: 52)
                        Conds(tracked: tracked, units: context.attributes.units, size: 12)
                    }
                    Label { ActivityRideTime(ride: ride) } icon: { Image(systemName: "timer") }
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.committed)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        // As well as the tint: the scheduled start's alert resolved the tint light under dark text.
        .background(Color.cardBackground)
        .widgetURL(RideLink(pick: ride.id).url)
    }
}

/// The ride time, as D's widgets give it, for a view that only redraws when the app updates it or it
/// goes stale (`WidgetSync` makes that the start, then the finish): "~3h ride · 09:00 → ~12:00"
/// before the start, then a countdown that ticks on its own, "1:29:59 to go · back ~12:00", then
/// "Ride over". The countdown stops at 0:00 if nothing redraws it at the finish.
private struct ActivityRideTime: View {
    var ride: RideWidgetSnapshot.Ride
    /// The expanded island's trailing corner: "09:00 · ~3h ride", "1:29:59 to go".
    var short = false

    var body: some View {
        let now = Date.now
        if now < ride.start {
            Text(short ? ride.rideTime(at: now, short: true) : "\(ride.duration) ride · \(ride.start.clock) → ~\(ride.finish.clock)")
        } else if now < ride.finish {
            let left = Text(timerInterval: ride.start...ride.finish, countsDown: true).monospacedDigit()
            if short {
                Text("\(left) to go")
            } else {
                Text("\(left) to go · back ~\(ride.finish.clock)")
            }
        } else {
            Text("Ride over")
        }
    }
}

/// The loop on a tile: no map image in a Live Activity.
private struct LoopTile: View {
    var loop: [Coordinate]
    var size: CGFloat

    var body: some View {
        LoopShape(loop: loop)
            .stroke(Color.rideAccent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            .padding(size * 0.15)
            .frame(width: size, height: size)
            .background(.fill.tertiary, in: .rect(cornerRadius: 12))
    }
}

/// The compact and minimal Dynamic Island's score.
private struct IslandScore: View {
    var score: Int

    var body: some View {
        Gauge(value: Double(score), in: 0...100) {
            EmptyView()
        } currentValueLabel: {
            Text("\(score)")
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(.rideAccent)
    }
}

#endif

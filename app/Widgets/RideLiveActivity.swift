#if os(iOS)
import SwiftUI
import WidgetKit
import ActivityKit
import Models
import DesignSystem

/// The tracked ride's Live Activity and Dynamic Island, in Widgets D's style (docs/redesign/README.md
/// §8): from the morning of the ride until the finish, when it goes stale and reads "Ride over".
struct RideLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RideActivityAttributes.self) { context in
            LockScreenActivity(context: context)
                .activityBackgroundTint(Color.cardBackground)
        } dynamicIsland: { context in
            let tracked = context.state, units = context.attributes.units
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(tracked.ride.name, systemImage: "bell.fill").font(.caption.weight(.semibold)).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.isStale ? "Ride over" : tracked.ride.rideTime(at: .now, short: true))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.committed)
                        .lineLimit(1)
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
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                IslandScore(score: tracked.score)
            } minimal: {
                IslandScore(score: tracked.score)
            }
            .widgetURL(RideLink(pick: tracked.ride.id).url)
            .keylineTint(.accentColor)
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
                if context.isStale {
                    Text("Ride over").font(.headline)
                } else {
                    HStack(spacing: 10) {
                        ScoreArc(score: tracked.score, change: tracked.change, warn: tracked.warn, size: 52)
                        Conds(tracked: tracked, units: context.attributes.units, size: 12)
                    }
                    Label("\(ride.duration) ride · \(ride.start.clock) → ~\(ride.finish.clock)", systemImage: "timer")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.committed)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .widgetURL(RideLink(pick: ride.id).url)
    }
}

/// The loop on a tile: no map image in a Live Activity.
private struct LoopTile: View {
    var loop: [Coordinate]
    var size: CGFloat

    var body: some View {
        LoopShape(loop: loop)
            .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
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
        .tint(.accentColor)
    }
}

#endif

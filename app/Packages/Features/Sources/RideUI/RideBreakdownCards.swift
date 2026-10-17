import SwiftUI
import Models
import SharedUI

/// "Sky on the Ride" (docs/redesign/README.md §2): how much of the ride is in sun, in ride order.
struct SkyOnTheRide: View {
    var sky: RideDetail.SkyBreakdown
    var start: Date
    var finish: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .symbolRenderingMode(.multicolor)
                    .font(.title2)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(sky.summary).font(.headline)
                    if sky.partial {
                        Text("Part of the ride isn't forecast yet.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .accessibilityElement(children: .combine)

            VStack(spacing: 6) {
                ShareBar(sky.segments.map { ShareBar.Segment(share: $0.share, color: $0.kind.tint) })
                RideTimes(start: start, finish: finish)
            }

            let legend = sky.legend
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                ForEach(legend, id: \.kind) { item in
                    GridRow {
                        LegendDot(color: item.kind.tint)
                        Text(item.kind.title)
                        Text(ShareText.written(item.share, alone: legend.count == 1))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
            .font(.subheadline)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(legend.map { "\($0.kind.title), \(ShareText.spoken($0.share, alone: legend.count == 1))" }.joined(separator: ". "))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var symbol: String {
        switch sky.look {
        case .sun: "sun.max"
        case .sunAndCloud: "cloud.sun"
        case .cloud: "cloud"
        case .fog: "cloud.fog"
        }
    }
}

/// "Wind on the Ride" (docs/redesign/README.md §2): the route coloured by the wind's effect, where it
/// blows from, each effect's share and the gusts.
struct WindOnTheRide: View {
    var wind: RideDetail.WindBreakdown
    var coordinates: [Coordinate]
    var start: Date
    var finish: Date
    @Environment(\.speedSystem) private var speedSystem
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if wind.exact, coordinates.count > 1 {
                WindRouteMap(coordinates, runs: wind.runs.map { WindRouteMap.Run(from: $0.from, to: $0.to, color: $0.effect.tint) },
                             showsFinish: wind.roundTrip != true)
                    .frame(height: 180)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26, style: .continuous))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(wind.journey(along: coordinates))
                    .accessibilityAddTraits(.isImage)
            }

            VStack(alignment: .leading, spacing: 14) {
                header

                VStack(spacing: 6) {
                    ShareBar(segments)
                    RideTimes(start: start, finish: finish)
                }

                let legend = wind.legend
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 8) {
                    ForEach(legend, id: \.effect) { item in
                        GridRow {
                            LegendDot(color: item.effect.tint)
                            Text(item.effect.title)
                            Text(speed(of: item)).foregroundStyle(.secondary)
                            Text(ShareText.written(item.share, alone: legend.count == 1))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                }
                .font(.subheadline)
                .monospacedDigit()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(legend.map { "\($0.effect.title), \(speed(of: $0)), \(ShareText.spoken($0.share, alone: legend.count == 1))" }.joined(separator: ". "))

                if let gusts = wind.gusts {
                    Divider()
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(gusts.title).fontWeight(.semibold)
                            Text(gusts.text).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "wind")
                            .foregroundStyle(gusts.warn ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                    }
                    .labelStyle(IconColumn())
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var header: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
        let from = wind.from
        return layout {
            VStack(alignment: .leading, spacing: 2) {
                Text(from.first.map { "Wind from the \($0)" } ?? "Light wind").font(.headline)
                Group {
                    if from.count > 1 {
                        Text("Then from the \(from[1]).")
                    } else if from.isEmpty {
                        Text("Under \(UnitFormat.speed(kph: RideDetail.WindBreakdown.namedKph, system: speedSystem)) all the way.")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityValue("Averaging \(UnitFormat.speed(kph: wind.averageKph, system: speedSystem))")

            WindCompass(towardsDegrees: wind.towardsDegrees, speed: number(wind.averageKph),
                        unit: speedSystem == .metric ? "km/h" : "mph")
        }
    }

    /// Compass points over the bar only where the wind turns, and only if it does.
    private var segments: [ShareBar.Segment] {
        var shown: String?
        var segments = wind.blocks.map { block -> ShareBar.Segment in
            var label: String?
            if let point = block.label, point != shown {
                label = point
                shown = point
            }
            return ShareBar.Segment(share: block.share, color: block.effect.tint, label: label)
        }
        if segments.compactMap(\.label).count < 2 {
            for i in segments.indices { segments[i].label = nil }
        }
        return segments
    }

    private func speed(of share: RideDetail.WindBreakdown.Share) -> String {
        share.effect == .light
            ? "under \(UnitFormat.speed(kph: RideDetail.WindBreakdown.namedKph, system: speedSystem))"
            : UnitFormat.speed(kph: share.kph, system: speedSystem)
    }

    /// "13": the number alone, in the rider's units.
    private func number(_ kph: Double) -> String {
        let speed = Measurement(value: kph, unit: UnitSpeed.kilometersPerHour)
        return Int(speed.converted(to: speedSystem == .metric ? .kilometersPerHour : .milesPerHour).value.rounded()).formatted()
    }
}

/// The ride's start under the bar's leading edge and its finish under the trailing one.
private struct RideTimes: View {
    var start: Date
    var finish: Date

    var body: some View {
        HStack {
            Text(start.formatted(.clockTime))
            Spacer()
            Text("~\(finish.formatted(.clockTime))")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .accessibilityHidden(true)
    }
}

private struct LegendDot: View {
    var color: Color
    @ScaledMetric(relativeTo: .subheadline) private var size = 8.0

    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
    }
}

/// The extension's rounded shares: to the nearest 5%, "<5%" below that, "Throughout" when alone.
private enum ShareText {
    static func written(_ share: Double, alone: Bool) -> String {
        alone ? "Throughout" : share < 0.025 ? "<5%" : "~\(Int((share * 20).rounded()) * 5)%"
    }

    static func spoken(_ share: Double, alone: Bool) -> String {
        alone ? "all the way" : share < 0.025 ? "under 5% of the ride" : "about \(Int((share * 20).rounded()) * 5)% of the ride"
    }
}

import SwiftUI
import Charts
import Domain

/// DESIGN-SYSTEM.md §6 component 6: "Along the Route". Elevation with its peak marked, over a
/// strip of the felt wind on the same distance axis, a worded legend, and scrubbing. Scrubbed on its
/// own, the point shows in a readout on the chart; with `selection` bound, the screen shows it
/// (ride detail writes it above the chart and pins it on the map) and the chart marks the point.
public struct RouteProfile: View {
    var elevation: [RideDetail.ElevationPoint]
    var wind: [RideDetail.WindStretch]
    /// The scrubbed distance in km, when the screen shows it.
    var scrub: Binding<Double?>?
    @State private var ownSelection: Double?
    @Environment(\.unitSystem) private var unitSystem
    /// The peak label draws above the plot; the card's padding fits it at default sizes.
    @ScaledMetric(relativeTo: .caption) private var peakLabelHeight = 16.0

    public init(elevation: [RideDetail.ElevationPoint], wind: [RideDetail.WindStretch], selection: Binding<Double?>? = nil) {
        self.elevation = elevation
        self.wind = wind
        self.scrub = selection
    }

    /// The chart's selection, in display units.
    private var selection: Binding<Double?> {
        guard let scrub else { return $ownSelection }
        let along = along
        return Binding { scrub.wrappedValue.map { $0 * along } } set: { scrub.wrappedValue = $0.map { $0 / along } }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            chart
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top) { legend }
                VStack(alignment: .leading, spacing: 10) { legend }
            }
        }
    }

    // MARK: Chart

    /// Display units: km or mi along, m or ft up.
    private var along: Double { unitSystem == .metric ? 1 : 0.621371 }
    private var up: Double { unitSystem == .metric ? 1 : 3.28084 }

    private var chart: some View {
        let points = elevation.map { (x: $0.km * along, y: $0.metres * up, metres: $0.metres) }
        let peak = points.max { $0.y < $1.y }
        let top = max(100, ((peak?.y ?? 0) / 100).rounded(.up) * 100)
        // The wind strip sits under the plot, in y-axis units so it shares the chart's x scale.
        let strip = top * 0.07
        let distanceSymbol = UnitFormat.distanceUnitSymbol(system: unitSystem)
        let lastX = points.last?.x ?? 0

        return Chart {
            ForEach(points, id: \.x) { point in
                AreaMark(x: .value("Distance", point.x), y: .value("Elevation", point.y))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(.linearGradient(colors: [.accentColor.opacity(0.25), .accentColor.opacity(0.03)], startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Distance", point.x), y: .value("Elevation", point.y))
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(Color.accentColor)
                    .lineStyle(StrokeStyle(lineWidth: 2))
            }
            ForEach(wind, id: \.startKm) { stretch in
                RectangleMark(xStart: .value("From", stretch.startKm * along),
                              xEnd: .value("To", stretch.endKm * along - (stretch == wind.last ? 0 : 0.4 * along)),
                              yStart: .value("Wind", -strip * 1.6),
                              yEnd: .value("Wind", -strip * 0.6))
                    .foregroundStyle(stretch.wind.tint)
                    .clipShape(.rect(cornerRadius: 2))
                    .accessibilityLabel(stretch.wind.title)
                    .accessibilityValue(UnitFormat.distance(km: stretch.endKm - stretch.startKm, system: unitSystem, fractionDigits: 0))
            }
            if let selection = selection.wrappedValue, scrub != nil,
               let point = points.min(by: { abs($0.x - selection) < abs($1.x - selection) }) {
                RuleMark(x: .value("Distance", point.x))
                    .foregroundStyle(.secondary)
                PointMark(x: .value("Distance", point.x), y: .value("Elevation", point.y))
                    .symbolSize(48)
                    .foregroundStyle(Color.accentColor)
            } else if let selection = selection.wrappedValue,
                      let point = points.min(by: { abs($0.x - selection) < abs($1.x - selection) }) {
                RuleMark(x: .value("Distance", point.x))
                    .foregroundStyle(.secondary)
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                        let km = point.x / along
                        let felt = wind.first { km >= $0.startKm && km <= $0.endKm }?.wind.title
                        VStack(spacing: 0) {
                            Text(UnitFormat.distance(km: km, system: unitSystem, fractionDigits: 0)).font(.caption.weight(.semibold))
                            Text([UnitFormat.elevation(m: point.metres, system: unitSystem), felt].compactMap(\.self).joined(separator: " · "))
                                .font(.caption)
                        }
                        .monospacedDigit()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.cardBackground, in: .rect(cornerRadius: 8))
                        .shadow(color: .black.opacity(0.12), radius: 4, y: 1)
                    }
            } else if let peak {
                PointMark(x: .value("Distance", peak.x), y: .value("Elevation", peak.y))
                    .symbolSize(36)
                    .foregroundStyle(Color.accentColor)
                    .annotation(position: .top, spacing: 2) {
                        Text(UnitFormat.elevation(m: peak.metres, system: unitSystem))
                            .font(.caption.weight(.semibold))
                    }
                    .accessibilityLabel("Highest point")
            }
        }
        .chartXScale(domain: 0...lastX)
        .chartYScale(domain: -strip * 1.6...top)
        .chartXAxis {
            AxisMarks(values: .stride(by: 10)) { value in
                AxisValueLabel(collisionResolution: .disabled) {
                    if let x = value.as(Double.self) {
                        // The unit rides on the last label only: "0 10 20 … 50 km".
                        Text(lastX - x < 10 ? "\(Int(x)) \(distanceSymbol)" : "\(Int(x))")
                            .fixedSize()
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: [0, top / 2, top]) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3]))
                AxisValueLabel {
                    if let y = value.as(Double.self) {
                        Text(y == top ? UnitFormat.elevation(m: y / up, system: unitSystem) : "\(Int(y))")
                    }
                }
            }
        }
        .chartXSelection(value: selection)
        .frame(height: 190)
        // Room for the peak label once it outgrows the card's padding.
        .padding(.top, max(0, peakLabelHeight - 16))
    }

    // MARK: Legend

    @ViewBuilder
    private var legend: some View {
        ForEach(Array(wind.enumerated()), id: \.offset) { index, stretch in
            let position = index == 0 ? "First" : index == wind.count - 1 ? "Last" : "Next"
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(stretch.wind.tint)
                        .frame(width: 14, height: 8)
                    Text(stretch.wind.title).font(.footnote)
                }
                Text("\(position) \(UnitFormat.distance(km: stretch.endKm - stretch.startKm, system: unitSystem, fractionDigits: 0))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 20)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

private extension RideBoard.Wind {
    var tint: Color {
        switch self {
        case .tailwind: .accentColor
        case .crosswind: .orange
        case .headwind: .red
        }
    }
}

#Preview {
    let detail = RideDetail.sample(for: RideBoard.sample.picks[0], on: .sample)
    RouteProfile(elevation: detail.elevation, wind: detail.departures[0].wind)
        .padding()
}

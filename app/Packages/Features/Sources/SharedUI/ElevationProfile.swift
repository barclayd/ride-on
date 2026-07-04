import SwiftUI
import Charts

/// One sample along the route: distance travelled so far -> elevation.
public struct ElevationPoint: Identifiable, Hashable, Sendable {
    public var id: Int
    public var distanceKm: Double
    public var elevationM: Double

    public init(id: Int, distanceKm: Double, elevationM: Double) {
        self.id = id
        self.distanceKm = distanceKm
        self.elevationM = elevationM
    }
}

/// DESIGN-SYSTEM.md §6 component 4: Swift Charts `AreaMark` (distance ->
/// elevation), monotone interpolation, gradient fill, `chartXSelection`
/// scrubbing with a `RuleMark` + annotation. `selectedDistanceKm` is a
/// binding so the caller (Route Detail) can sync a dot on the route `Map` to
/// the scrub position.
public struct ElevationProfile: View {
    public var points: [ElevationPoint]
    @Binding public var selectedDistanceKm: Double?

    public init(points: [ElevationPoint], selectedDistanceKm: Binding<Double?>) {
        self.points = points
        self._selectedDistanceKm = selectedDistanceKm
    }

    private var nearestSelectedPoint: ElevationPoint? {
        guard let selectedDistanceKm else { return nil }
        return points.min { abs($0.distanceKm - selectedDistanceKm) < abs($1.distanceKm - selectedDistanceKm) }
    }

    public var body: some View {
        Group {
            if points.count > 1 {
                Chart(points) { point in
                    AreaMark(
                        x: .value("Distance", point.distanceKm),
                        y: .value("Elevation", point.elevationM)
                    )
                    .interpolationMethod(.monotone)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [Color.accentColor.opacity(0.45), Color.accentColor.opacity(0.03)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )

                    LineMark(
                        x: .value("Distance", point.distanceKm),
                        y: .value("Elevation", point.elevationM)
                    )
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Color.accentColor)
                    .lineStyle(StrokeStyle(lineWidth: 2))

                    if let nearestSelectedPoint {
                        RuleMark(x: .value("Selected", nearestSelectedPoint.distanceKm))
                            .foregroundStyle(.secondary.opacity(0.6))
                            .annotation(position: .top) {
                                Text("\(Int(nearestSelectedPoint.elevationM.rounded()))m")
                                    .font(.caption.monospacedDigit())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(.regularMaterial, in: .capsule)
                            }
                    }
                }
                .chartXSelection(value: $selectedDistanceKm)
                .chartXAxisLabel("km")
                .chartYAxisLabel("m")
                .chartLegend(.hidden)
            } else {
                ContentUnavailableView("No Elevation Data", systemImage: "chart.xyaxis.line")
            }
        }
        .frame(height: 140)
        // ponytail: a full `AXChartDescriptorRepresentable` (axChartDescriptor)
        // is DESIGN-SYSTEM.md §8's accessibility bar, which is Phase 7's pass,
        // not Phase 4's; the plain accessibility label below covers VoiceOver
        // for now.
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: String {
        guard let minPoint = points.min(by: { $0.elevationM < $1.elevationM }),
              let maxPoint = points.max(by: { $0.elevationM < $1.elevationM }) else {
            return "No elevation data"
        }
        return "Elevation profile from \(Int(minPoint.elevationM))m to \(Int(maxPoint.elevationM))m"
    }
}

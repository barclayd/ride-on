import SwiftUI
import Charts
import Accessibility
import Models

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
    @Environment(\.unitSystem) private var unitSystem

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
                                Text(UnitFormat.elevation(m: nearestSelectedPoint.elevationM, system: unitSystem))
                                    .font(.caption.monospacedDigit())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(.regularMaterial, in: .capsule)
                            }
                    }
                }
                .chartXSelection(value: $selectedDistanceKm)
                .chartXAxisLabel(UnitFormat.distanceUnitSymbol(system: unitSystem))
                .chartYAxisLabel(UnitFormat.elevationUnitSymbol(system: unitSystem))
                .chartLegend(.hidden)
            } else {
                ContentUnavailableView("No Elevation Data", systemImage: "chart.xyaxis.line")
            }
        }
        .frame(height: 140)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityChartDescriptor(ElevationChartDescriptor(points: points, system: unitSystem))
    }

    private var accessibilitySummary: String {
        guard let minPoint = points.min(by: { $0.elevationM < $1.elevationM }),
              let maxPoint = points.max(by: { $0.elevationM < $1.elevationM }) else {
            return "No elevation data"
        }
        return "Elevation profile from \(UnitFormat.elevation(m: minPoint.elevationM, system: unitSystem)) to \(UnitFormat.elevation(m: maxPoint.elevationM, system: unitSystem))"
    }
}

/// DESIGN-SYSTEM.md §8's audio-graph descriptor: lets VoiceOver users hear
/// the elevation profile as an audio graph (rising/falling tones), not just
/// read the summary label.
private struct ElevationChartDescriptor: AXChartDescriptorRepresentable {
    var points: [ElevationPoint]
    var system: UnitSystem

    func makeChartDescriptor() -> AXChartDescriptor {
        let distances = points.map(\.distanceKm)
        let elevations = points.map(\.elevationM)
        let xAxis = AXNumericDataAxisDescriptor(
            title: "Distance",
            range: (distances.min() ?? 0)...(distances.max() ?? 0),
            gridlinePositions: []
        ) { UnitFormat.distance(km: $0, system: system) }
        let yAxis = AXNumericDataAxisDescriptor(
            title: "Elevation",
            range: (elevations.min() ?? 0)...(elevations.max() ?? 0),
            gridlinePositions: []
        ) { UnitFormat.elevation(m: $0, system: system) }
        return AXChartDescriptor(
            title: "Elevation Profile",
            summary: nil,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [dataSeries]
        )
    }

    func updateChartDescriptor(_ descriptor: AXChartDescriptor) {
        descriptor.series = [dataSeries]
    }

    private var dataSeries: AXDataSeriesDescriptor {
        AXDataSeriesDescriptor(
            name: "Elevation",
            isContinuous: true,
            dataPoints: points.map { AXDataPoint(x: $0.distanceKm, y: $0.elevationM) }
        )
    }
}

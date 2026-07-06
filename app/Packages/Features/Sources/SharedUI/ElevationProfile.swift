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

    /// Swift Charts builds one mark per data point; a ~5000-point GPX track
    /// would emit ~10k marks and beachball on first layout. The plot is only
    /// a few hundred points wide, so downsample to a fixed cap (endpoints
    /// preserved) — visually identical, cheap to render and re-scrub.
    private static let maxRenderedPoints = 250

    private var displayPoints: [ElevationPoint] {
        guard points.count > Self.maxRenderedPoints else { return points }
        let stride = Double(points.count - 1) / Double(Self.maxRenderedPoints - 1)
        return (0..<Self.maxRenderedPoints).map { points[Int((Double($0) * stride).rounded())] }
    }

    private func nearestSelectedPoint(in samples: [ElevationPoint]) -> ElevationPoint? {
        guard let selectedDistanceKm else { return nil }
        return samples.min { abs($0.distanceKm - selectedDistanceKm) < abs($1.distanceKm - selectedDistanceKm) }
    }

    public var body: some View {
        let displayPoints = displayPoints
        let nearestSelectedPoint = nearestSelectedPoint(in: displayPoints)
        return Group {
            if displayPoints.count > 1 {
                Chart(displayPoints) { point in
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
        .accessibilityChartDescriptor(ElevationChartDescriptor(points: displayPoints, system: unitSystem))
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

#Preview {
    @Previewable @State var selected: Double?
    ElevationProfile(
        points: (0..<60).map { index in
            ElevationPoint(id: index, distanceKm: Double(index) * 0.5, elevationM: 120 + 80 * sin(Double(index) / 8))
        },
        selectedDistanceKm: $selected
    )
    .padding()
}

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
    private static let maxRenderedPoints = 500

    private var displayPoints: [ElevationPoint] {
        guard points.count > Self.maxRenderedPoints else { return points }
        let stride = Double(points.count - 1) / Double(Self.maxRenderedPoints - 1)
        return (0..<Self.maxRenderedPoints).map { points[Int((Double($0) * stride).rounded())] }
    }

    /// Pinned y-domain (with a little headroom). Without it, the scrub
    /// `RuleMark`'s annotation capsule renders above the peak and Swift Charts
    /// auto-expands the axis to fit it — the elevation scale visibly doubles
    /// (e.g. 300→600 m) on hover and the plot re-lays-out every tick.
    private func elevationDomain(_ samples: [ElevationPoint]) -> ClosedRange<Double> {
        let elevations = samples.map(\.elevationM)
        guard let lo = elevations.min(), let hi = elevations.max(), hi > lo else { return 0...100 }
        let pad = (hi - lo) * 0.15
        return (lo - pad)...(hi + pad)
    }

    public var body: some View {
        let displayPoints = displayPoints
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
                }
                .chartYScale(domain: elevationDomain(displayPoints))
                // Pin the x-domain to the route's length so the plot fills the
                // width — Swift Charts otherwise auto-pads past the last point,
                // leaving a gap between the trace and the axis edge.
                .chartXScale(domain: 0...(displayPoints.last?.distanceKm ?? 1), range: .plotDimension(padding: 0))
                .chartXSelection(value: $selectedDistanceKm)
                .chartXAxisLabel(UnitFormat.distanceUnitSymbol(system: unitSystem))
                .chartYAxisLabel(UnitFormat.elevationUnitSymbol(system: unitSystem))
                .chartLegend(.hidden)
                // The scrub indicator lives in an overlay child, NOT as a
                // RuleMark inside the Chart. A RuleMark reading the selection
                // re-ran the whole `body` on every scrub tick — rebuilding all
                // ~1000 monotone marks each time, pinning CPU to 100% on a long
                // route. As an overlay that reads the binding itself, only the
                // thin indicator re-renders; the trace is tessellated once.
                .chartOverlay { proxy in
                    ScrubIndicator(
                        selection: $selectedDistanceKm,
                        points: displayPoints,
                        proxy: proxy,
                        unitSystem: unitSystem
                    )
                }
            } else {
                ContentUnavailableView("No Elevation Data", systemImage: "chart.xyaxis.line")
            }
        }
        .frame(height: 140)
        .accessibilityLabel(accessibilitySummary(displayPoints))
        .accessibilityChartDescriptor(ElevationChartDescriptor(points: displayPoints, system: unitSystem))
    }

    private func accessibilitySummary(_ samples: [ElevationPoint]) -> String {
        guard let minPoint = samples.min(by: { $0.elevationM < $1.elevationM }),
              let maxPoint = samples.max(by: { $0.elevationM < $1.elevationM }) else {
            return "No elevation data"
        }
        return "Elevation profile from \(UnitFormat.elevation(m: minPoint.elevationM, system: unitSystem)) to \(UnitFormat.elevation(m: maxPoint.elevationM, system: unitSystem))"
    }
}

/// The scrub rule + elevation capsule, drawn as a `.chartOverlay` child so it
/// re-renders in isolation on hover — the `Chart`'s marks don't depend on the
/// selection, so they aren't re-tessellated. Reads the binding's value itself
/// (not the parent), which is what keeps the re-render local.
private struct ScrubIndicator: View {
    @Binding var selection: Double?
    let points: [ElevationPoint]
    let proxy: ChartProxy
    let unitSystem: UnitSystem

    var body: some View {
        GeometryReader { geo in
            if let selection,
               let nearest = points.min(by: { abs($0.distanceKm - selection) < abs($1.distanceKm - selection) }),
               let plotFrame = proxy.plotFrame,
               let xInPlot = proxy.position(forX: nearest.distanceKm) {
                let rect = geo[plotFrame]
                let x = rect.minX + xInPlot

                Path { path in
                    path.move(to: CGPoint(x: x, y: rect.minY))
                    path.addLine(to: CGPoint(x: x, y: rect.maxY))
                }
                .stroke(Color.secondary.opacity(0.6), lineWidth: 1)

                Text(UnitFormat.elevation(m: nearest.elevationM, system: unitSystem))
                    .font(.caption.monospacedDigit())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(.regularMaterial, in: .capsule)
                    .fixedSize()
                    .position(x: x, y: rect.minY)
            }
        }
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

import SwiftUI
import Models
import Accessibility

/// DESIGN-SYSTEM.md §6 component 5: the cycle.travel-style stacked
/// horizontal bar of busy-road/paved/unpaved/path percentages, with a
/// `.caption` legend.
public struct SurfaceBar: View {
    public var surfaces: SurfaceBreakdown

    public init(surfaces: SurfaceBreakdown) {
        self.surfaces = surfaces
    }

    private static let order: [SurfaceType] = [.paved, .busyRoad, .unpaved, .path, .unknown]

    private static func color(for type: SurfaceType) -> Color {
        switch type {
        case .paved: .green
        case .busyRoad: .red
        case .unpaved: .orange
        case .path: .blue
        case .unknown: .gray
        }
    }

    private static func label(for type: SurfaceType) -> String {
        switch type {
        case .paved: "Paved"
        case .busyRoad: "Busy Road"
        case .unpaved: "Unpaved"
        case .path: "Path"
        case .unknown: "Unknown"
        }
    }

    private var shares: [SurfaceType: Double] { surfaces.shareBySurface }
    private var presentTypes: [SurfaceType] { Self.order.filter { (shares[$0] ?? 0) > 0.001 } }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if presentTypes.isEmpty {
                Text("Surface breakdown not available yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                GeometryReader { geometry in
                    HStack(spacing: presentTypes.count > 1 ? 2 : 0) {
                        ForEach(presentTypes, id: \.self) { type in
                            Self.color(for: type)
                                .frame(width: geometry.size.width * (shares[type] ?? 0))
                        }
                    }
                }
                .frame(height: 10)
                .clipShape(.capsule)

                VStack(alignment: .leading, spacing: 4) {
                    ForEach(presentTypes, id: \.self) { type in
                        HStack(spacing: 6) {
                            Circle().fill(Self.color(for: type)).frame(width: 8, height: 8)
                            Text("\(Self.label(for: type)) · \(Int(((shares[type] ?? 0) * 100).rounded()))%")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
        .modifier(SurfaceChartDescriptorModifier(presentTypes: presentTypes, shares: shares))
    }

    private var accessibilityDescription: String {
        guard !presentTypes.isEmpty else { return "Surface breakdown not available" }
        return "Surface: " + presentTypes.map { "\(Int(((shares[$0] ?? 0) * 100).rounded()))% \(Self.label(for: $0))" }.joined(separator: ", ")
    }
}

/// A `ViewModifier` (not inline in `body`) since `.accessibilityChartDescriptor`
/// needs a concrete, non-empty series — skipped entirely when there's
/// nothing to plot yet.
private struct SurfaceChartDescriptorModifier: ViewModifier {
    var presentTypes: [SurfaceType]
    var shares: [SurfaceType: Double]

    func body(content: Content) -> some View {
        if presentTypes.isEmpty {
            content
        } else {
            content.accessibilityChartDescriptor(SurfaceChartDescriptor(presentTypes: presentTypes, shares: shares))
        }
    }
}

/// DESIGN-SYSTEM.md §8's audio-graph descriptor for the surface bar: an
/// audio graph over the busy-road/paved/unpaved/path percentage split.
private struct SurfaceChartDescriptor: AXChartDescriptorRepresentable {
    var presentTypes: [SurfaceType]
    var shares: [SurfaceType: Double]

    private static func label(for type: SurfaceType) -> String {
        switch type {
        case .paved: "Paved"
        case .busyRoad: "Busy Road"
        case .unpaved: "Unpaved"
        case .path: "Path"
        case .unknown: "Unknown"
        }
    }

    func makeChartDescriptor() -> AXChartDescriptor {
        let xAxis = AXCategoricalDataAxisDescriptor(
            title: "Surface",
            categoryOrder: presentTypes.map(Self.label(for:))
        )
        let yAxis = AXNumericDataAxisDescriptor(
            title: "Share",
            range: 0...100,
            gridlinePositions: []
        ) { "\(Int($0))%" }
        return AXChartDescriptor(
            title: "Surface Breakdown",
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
            name: "Surface breakdown",
            isContinuous: false,
            dataPoints: presentTypes.map { type in
                AXDataPoint(x: Self.label(for: type), y: ((shares[type] ?? 0) * 100).rounded())
            }
        )
    }
}

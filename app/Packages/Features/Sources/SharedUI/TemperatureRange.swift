import SwiftUI
import DesignSystem
import Models

/// DESIGN-SYSTEM.md §6.8: Ideal Temperature's two-handle range on the `ConditionPalette` ramp,
/// in whole degrees Celsius. SwiftUI has no range slider, so each handle is dragged on its own
/// and is its own adjustable VoiceOver element.
public struct TemperatureRange: View {
    @Binding var range: ClosedRange<Double>
    var bounds: ClosedRange<Double>
    @Environment(\.locale) private var locale

    private let handle = CGSize(width: 38, height: 26)

    public init(_ range: Binding<ClosedRange<Double>>, in bounds: ClosedRange<Double> = 0...35) {
        _range = range
        self.bounds = bounds
    }

    public var body: some View {
        VStack(spacing: 8) {
            GeometryReader { proxy in
                let track = proxy.size.width - handle.width
                ZStack(alignment: .leading) {
                    Bar(range, in: bounds)
                        .frame(height: 6)
                        .padding(.horizontal, handle.width / 2)
                    thumb(\.lowerBound, "Lowest", track: track)
                    thumb(\.upperBound, "Highest", track: track)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: handle.height + 8)
            ticks
        }
        .sensoryFeedback(.selection, trigger: range)
    }

    private func x(_ c: Double, track: CGFloat) -> CGFloat {
        CGFloat((c - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound)) * track
    }

    private func thumb(_ end: KeyPath<ClosedRange<Double>, Double>, _ name: String, track: CGFloat) -> some View {
        Capsule()
            .fill(.white)
            .shadow(color: .black.opacity(0.18), radius: 3, y: 1)
            .frame(width: handle.width, height: handle.height)
            .offset(x: x(range[keyPath: end], track: track))
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .local).onChanged { drag in
                let fraction = Double((drag.location.x - handle.width / 2) / track)
                set(end, to: bounds.lowerBound + fraction * (bounds.upperBound - bounds.lowerBound))
            })
            .accessibilityElement()
            .accessibilityLabel(name)
            .accessibilityValue(UnitFormat.degrees(c: range[keyPath: end], locale: locale))
            .accessibilityAdjustableAction { direction in
                set(end, to: range[keyPath: end] + (direction == .increment ? 1 : -1))
            }
    }

    /// Whole degrees, kept inside the bounds; the handles can meet but not cross.
    private func set(_ end: KeyPath<ClosedRange<Double>, Double>, to value: Double) {
        let c = min(max(value.rounded(), bounds.lowerBound), bounds.upperBound)
        range = end == \.lowerBound ? min(c, range.upperBound)...range.upperBound : range.lowerBound...max(c, range.lowerBound)
    }

    private var ticks: some View {
        GeometryReader { proxy in
            let track = proxy.size.width - handle.width
            ForEach(Array(stride(from: bounds.lowerBound, to: bounds.upperBound, by: 10)), id: \.self) { c in
                Text(UnitFormat.degrees(c: c, locale: locale))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize()
                    .position(x: handle.width / 2 + x(c, track: track), y: proxy.size.height / 2)
            }
        }
        .frame(height: 16)
        .accessibilityHidden(true)
    }

    /// The ramp from `bounds.lowerBound` to `bounds.upperBound`, banded the same as everywhere else.
    static func ramp(_ bounds: ClosedRange<Double>) -> LinearGradient {
        let steps = 6
        let colors = (0...steps).map { i in
            ConditionPalette.color(forTemperatureC: bounds.lowerBound + Double(i) / Double(steps) * (bounds.upperBound - bounds.lowerBound))
        }
        return LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
    }

    /// A Weather-style range bar. With `preference`, it's a "How Your Routes Fit" row: a grey
    /// track, the preferred range darker, and the route's range in colour on top. Without one,
    /// it's the ramp, faded outside `range`.
    public struct Bar: View {
        var range: ClosedRange<Double>
        var preference: ClosedRange<Double>?
        var bounds: ClosedRange<Double>

        public init(_ range: ClosedRange<Double>, against preference: ClosedRange<Double>? = nil, in bounds: ClosedRange<Double> = 0...35) {
            self.range = range
            self.preference = preference
            self.bounds = bounds
        }

        public var body: some View {
            GeometryReader { proxy in
                let ramp = TemperatureRange.ramp(bounds)
                ZStack(alignment: .leading) {
                    if let preference {
                        Capsule().fill(.quaternary)
                        Capsule().fill(.tertiary).frame(width: width(preference, proxy)).offset(x: offset(preference, proxy))
                    } else {
                        Capsule().fill(ramp).opacity(0.35)
                    }
                    Capsule().fill(ramp)
                        .mask(alignment: .leading) {
                            Capsule().frame(width: max(width(range, proxy), proxy.size.height)).offset(x: offset(range, proxy))
                        }
                }
            }
            .accessibilityHidden(true)
        }

        private func offset(_ r: ClosedRange<Double>, _ proxy: GeometryProxy) -> CGFloat {
            proxy.size.width * fraction(r.lowerBound)
        }

        private func width(_ r: ClosedRange<Double>, _ proxy: GeometryProxy) -> CGFloat {
            proxy.size.width * (fraction(r.upperBound) - fraction(r.lowerBound))
        }

        private func fraction(_ c: Double) -> CGFloat {
            CGFloat(min(max((c - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound), 0), 1))
        }
    }
}

#Preview {
    @Previewable @State var range = 10.0...22
    Form {
        TemperatureRange($range)
        TemperatureRange.Bar(9...14, against: range).frame(height: 6)
        TemperatureRange.Bar(range).frame(width: 80, height: 4)
    }
}

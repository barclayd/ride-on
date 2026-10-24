import SwiftUI
import WidgetKit
import ImageIO
import MapKit
import Models
import DesignSystem

// The pieces both variants share (docs/redesign/README.md §8). The widget can't import SharedUI (it
// links MapLibre), so the score arc follows ScoreGauge's look here.

extension RideWidgetSnapshot.Units {
    var locale: Locale { Locale.current.temperatureUnit(temperature) }
    func temperatures(_ c: ClosedRange<Double>) -> String { UnitFormat.temperatureRange(c: c, locale: locale) }
    func degrees(_ c: Double) -> String { UnitFormat.degrees(c: c, locale: locale) }
    func distance(_ km: Double) -> String { UnitFormat.distance(km: km, system: distance, fractionDigits: 0) }
    func climb(_ m: Double) -> String { UnitFormat.elevation(m: m, system: distance) }
    /// The number alone, as the canvas writes wind: "Tailwind 15".
    func wind(_ kph: Double) -> String { "\(Int((speed == .metric ? kph : kph / 1.609344).rounded()))" }
    func windSpeed(_ kph: Double) -> String { UnitFormat.speed(kph: kph, system: speed) }
}

extension RideWidgetSnapshot.Ride {
    var dry: String { sky == .rain ? "Rain" : "Dry" }
    /// "Tailwind · Dry", or the warning.
    var note: String { meetsMinimums ? "\(wind.title) · \(dry)" : "Below your minimums" }
}

extension RideWidgetSnapshot.Tracked {
    /// A minimum now fails: the arc and its line turn the warning colour.
    var warn: Bool { !warnings.isEmpty || !ride.meetsMinimums }
}

extension RideBoard.Wind {
    /// RouteProfile's wind colours.
    var tint: Color {
        switch self {
        case .tailwind: .accentColor
        case .crosswind: .orange
        case .headwind: .red
        }
    }
}

extension Date {
    var clock: String { formatted(.clockTime) }
    /// "Wed 14".
    var weekdayDay: String { formatted(.dateTime.weekday(.abbreviated).day()) }
    var weekday: String { formatted(.dateTime.weekday(.abbreviated)) }

    /// "Today", "Tomorrow" or "Wed", from `now`.
    func dayWord(from now: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDate(self, inSameDayAs: now) { return "Today" }
        if let next = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(self, inSameDayAs: next) { return "Tomorrow" }
        return weekday
    }
}

// MARK: - Map

/// A ride's map still from the App Group, with the loop drawn over it: the progress and hour chips
/// move without a new image. Until the app has rendered one, the loop on the map's land colour.
struct MapPanel: View {
    var ride: RideWidgetSnapshot.Ride?
    var shape: WidgetMap.Shape
    var units: RideWidgetSnapshot.Units
    /// How far along the ride is, while riding.
    var progress: Double?
    /// The forecast pinned to the loop where the rider will be (large and extra large).
    var hours = false

    @Environment(\.displayScale) private var scale

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let rect = ride.map { WidgetMap.framing($0.loop, shape) } ?? .null
            let still = rect.isNull ? nil : Self.still(WidgetMap.url(rect, shape), pixels: max(size.width, size.height) * scale)
            ZStack(alignment: .topLeading) {
                Color.routeLand
                if let still {
                    Image(decorative: still, scale: scale)
                        .resizable()
                        .widgetAccentedRenderingMode(.desaturated)
                        .scaledToFill()
                        .frame(width: size.width, height: size.height)
                }
                if let ride, !rect.isNull {
                    let path = Path { $0.addLines(WidgetMap.project(ride.loop, in: rect, size: size)) }
                    Loop(path: path, progress: progress)
                    if hours { HourChips(ride: ride, path: path, size: size, units: units) }
                }
                if still != nil {
                    Text(Self.attribution)
                        .font(.system(size: 7))
                        .foregroundStyle(.secondary)
                        .padding(4)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                }
            }
        }
        .clipped()
        // The map stays light in Dark Mode (DESIGN-SYSTEM.md §3).
        .environment(\.colorScheme, .light)
    }

    #if os(macOS)
    static let attribution = "Apple Maps"
    #else
    static let attribution = "© OpenStreetMap"
    #endif

    /// Decoded at the size shown: a widget has little memory to spare.
    static func still(_ url: URL?, pixels: CGFloat) -> CGImage? {
        guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: pixels,
                       kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    }
}

/// The loop, cased as `RouteMap` draws it, its start marked; the ridden part gold.
private struct Loop: View {
    var path: Path
    var progress: Double?

    var body: some View {
        let line = { (width: CGFloat) in StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round) }
        ZStack(alignment: .topLeading) {
            path.stroke(.white, style: line(5.5))
            path.stroke(Color.accentColor, style: line(3)).widgetAccentable()
            if let progress, progress > 0 {
                path.trimmedPath(from: 0, to: progress).stroke(Color.committed, style: line(3))
            }
            if let start = path.trimmedPath(from: 0, to: 0.0001).currentPoint {
                Marker(fill: .white, ring: .accentColor).position(start)
            }
            if let progress, let at = path.trimmedPath(from: 0, to: max(progress, 0.0001)).currentPoint {
                Marker(fill: .committed, ring: .white).position(at)
            }
        }
    }
}

private struct Marker: View {
    var fill: Color
    var ring: Color

    var body: some View {
        Circle().fill(fill).stroke(ring, lineWidth: 2).frame(width: 8, height: 8)
    }
}

/// Up to two hours, pinned where the rider will be then.
private struct HourChips: View {
    var ride: RideWidgetSnapshot.Ride
    var path: Path
    var size: CGSize
    var units: RideWidgetSnapshot.Units

    var body: some View {
        let span = ride.finish.timeIntervalSince(ride.start)
        let pinned = ride.hours.compactMap { hour -> (RideWidgetSnapshot.Hour, CGPoint)? in
            let fraction = span > 0 ? hour.time.timeIntervalSince(ride.start) / span : 0
            guard (0.15...0.85).contains(fraction), let at = path.trimmedPath(from: 0, to: fraction).currentPoint else { return nil }
            return (hour, at)
        }.prefix(2)
        ForEach(pinned, id: \.0) { hour, at in
            let left = at.x > size.width * 0.6
            HStack(spacing: 2) {
                Text("\(hour.time.clock) · \(units.degrees(hour.temperatureC))")
                Image(systemName: ride.wind.systemImage).foregroundStyle(ride.wind.tint)
                Text(units.wind(hour.windKph))
            }
            .mapChip(size: 9)
            .fixedSize()
            .alignmentGuide(.leading) { d in left ? d.width - at.x + 6 : -at.x - 6 }
            .alignmentGuide(.top) { d in d.height / 2 - at.y }
        }
    }
}

extension View {
    /// A white capsule over the map.
    func mapChip(size: CGFloat = 10) -> some View {
        font(.system(size: size, weight: .semibold))
            .foregroundStyle(.black)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(.white, in: .capsule)
    }
}

/// The ride's loop alone, for the Lock Screen and the Dynamic Island: no image there.
struct LoopShape: Shape {
    var loop: [Coordinate]

    func path(in rect: CGRect) -> Path {
        let framing = WidgetMap.framing(loop, aspect: rect.width / max(rect.height, 1), pad: 1.1)
        guard !framing.isNull else { return Path() }
        return Path { $0.addLines(WidgetMap.project(loop, in: framing, size: rect.size)) }
            .offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

// MARK: - Score

/// The score in a pill: the best ride filled with the accent, below minimums in the warning colour.
struct ScorePill: View {
    var score: Int
    var meetsMinimums: Bool
    var best: Bool

    var body: some View {
        Text("\(score)")
            .font(.system(size: 11, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(!meetsMinimums ? Color.belowMinimums : best ? .white : .primary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(!meetsMinimums ? AnyShapeStyle(Color.belowMinimums.opacity(0.15))
                        : best ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.fill.tertiary), in: .capsule)
            .widgetAccentable(best)
    }
}

/// The tracked ride's score: ScoreGauge's ring opened at the bottom, with what it's moved by since
/// tracking started.
struct ScoreArc: View {
    var score: Int
    var change: Int
    var warn: Bool
    var size: CGFloat

    var body: some View {
        let line = StrokeStyle(lineWidth: size / 11, lineCap: .round)
        ZStack {
            Group {
                Circle().trim(from: 0, to: 0.75).stroke(.fill.tertiary, style: line)
                Circle().trim(from: 0, to: 0.75 * Double(min(max(score, 0), 100)) / 100)
                    .stroke(warn ? Color.belowMinimums : .accentColor, style: line)
                    .widgetAccentable()
            }
            .rotationEffect(.degrees(135))
            VStack(spacing: 0) {
                Text("\(score)").font(.system(size: size * 0.36, weight: .bold)).monospacedDigit()
                if change != 0 {
                    Text("\(change > 0 ? "▲" : "▼")\(abs(change))")
                        .font(.system(size: size * 0.15, weight: .semibold))
                        .foregroundStyle(change > 0 ? Color.accentColor : .belowMinimums)
                }
            }
        }
        .padding(size / 22)
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Score \(score) out of 100")
    }
}

// MARK: - Conditions

/// The tracked ride's three lines: sky and temperature, wind, and what the latest check found.
struct Conds: View {
    var tracked: RideWidgetSnapshot.Tracked
    var units: RideWidgetSnapshot.Units
    var size: CGFloat

    var body: some View {
        let ride = tracked.ride, warnings = tracked.warnings
        VStack(alignment: .leading, spacing: size * 0.3) {
            row(ride.sky.systemImage, "\(units.temperatures(ride.temperatureC)) · \(ride.dry)",
                warn: !warnings.isDisjoint(with: [.cold, .heat, .rain]))
            row(ride.wind.systemImage, "\(ride.wind.title) \(units.wind(ride.windKph))", tint: ride.wind.tint, warn: warnings.contains(.wind))
            let (symbol, text, tint) = status
            row(symbol, text, tint: tint, textTint: tint)
        }
        .font(.system(size: size, weight: .medium))
        .lineLimit(1)
    }

    private func row(_ symbol: String, _ text: String, tint: Color = .secondary, warn: Bool = false, textTint: Color = .primary) -> some View {
        HStack(spacing: 4) {
            Image(systemName: warn ? "exclamationmark.triangle.fill" : symbol)
                .foregroundStyle(warn ? Color.belowMinimums : tint)
                .frame(width: size * 1.1)
            Text(text).foregroundStyle(warn ? Color.belowMinimums : textTint)
        }
    }

    private var status: (String, String, Color) {
        let ride = tracked.ride
        switch tracked.check {
        case .unchanged: return ("checkmark", "No changes", .secondary)
        case .changed:
            let warnings = tracked.warnings
            let text = warnings.contains(.wind) ? "Gusts \(units.windSpeed(ride.gustKph))"
                : warnings.contains(.rain) ? "Rain likely"
                : warnings.contains(.cold) ? "Down to \(units.degrees(ride.temperatureC.lowerBound))"
                : "Up to \(units.degrees(ride.temperatureC.upperBound))"
            return ("exclamationmark.triangle.fill", text, .belowMinimums)
        case .betterRide: return ("star.fill", "Better ride found", .accentColor)
        case .checking: return ("arrow.clockwise", "Checking…", .secondary)
        case .due: return ("clock", "Check due", .secondary)
        case .failed: return ("exclamationmark.circle", "Couldn't check", .secondary)
        case .closed: return ("lock", "No more checks", .secondary)
        }
    }
}

/// "Along the ride": one cell an hour.
struct HourCells: View {
    var ride: RideWidgetSnapshot.Ride
    var units: RideWidgetSnapshot.Units

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ride.hours.prefix(4), id: \.self) { hour in
                VStack(spacing: 3) {
                    Text(hour.time.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)))).foregroundStyle(.secondary)
                    Image(systemName: hour.sky.systemImage).symbolRenderingMode(.multicolor).frame(height: 14)
                    Text(units.degrees(hour.temperatureC)).font(.system(size: 13, weight: .semibold))
                    HStack(spacing: 1) {
                        Image(systemName: ride.wind.systemImage).foregroundStyle(ride.wind.tint)
                        Text(units.wind(hour.windKph))
                    }
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .font(.system(size: 10, weight: .medium))
    }
}

/// "Along the ride", "Next 6 days": a small capitals heading.
struct Heading: View {
    var text: String
    var tint: Color = .secondary

    var body: some View {
        Text(text.uppercased()).font(.system(size: 10, weight: .semibold)).kerning(0.4).foregroundStyle(tint)
    }
}

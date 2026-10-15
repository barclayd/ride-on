import SwiftUI
import Models

/// Display-only unit formatting. Canonical storage/engine values stay metric
/// everywhere else (distanceKm, elevationGainM, windKph, temperatureC,
/// speed km/h) — this converts for display. Distance/elevation follow
/// `\.unitSystem`, wind/riding speed `\.speedSystem`: the account saves them
/// separately, so mph with kilometres is fine. Both default from the locale.
/// Temperature follows the locale, which the app root rewrites to the saved unit.
public enum UnitFormat {
    /// Ride distance: km (metric) or miles (imperial).
    public static func distance(km: Double, system: UnitSystem, fractionDigits: Int = 1, locale: Locale = .current) -> String {
        let measurement = Measurement(value: km, unit: UnitLength.kilometers)
        return (system == .metric ? measurement : measurement.converted(to: .miles))
            .formatted(
                .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(fractionDigits)))
                    .locale(locale)
            )
    }

    /// Just the distance unit symbol ("km"/"mi") — for chart axis labels.
    public static func distanceUnitSymbol(system: UnitSystem, locale: Locale = .current) -> String {
        unitSymbol(from: distance(km: 1, system: system, locale: locale))
    }

    /// Elevation: metres (metric) or feet (imperial). The unit is pinned
    /// (`usage: .asProvided`) — `.general` rescales by magnitude, so small
    /// gains rendered as inches ("0 in gain").
    public static func elevation(m: Double, system: UnitSystem, locale: Locale = .current) -> String {
        let measurement = Measurement(value: m, unit: UnitLength.meters)
        return (system == .metric ? measurement : measurement.converted(to: .feet))
            .formatted(
                .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(0)))
                    .locale(locale)
            )
    }

    /// Just the elevation unit symbol ("m"/"ft") — for chart axis labels.
    public static func elevationUnitSymbol(system: UnitSystem, locale: Locale = .current) -> String {
        unitSymbol(from: elevation(m: 1, system: system, locale: locale))
    }

    /// Temperature: respects the iOS per-app temperature unit override
    /// (`usage: .weather`).
    public static func temperature(c: Double, locale: Locale = .current) -> String {
        Measurement(value: c, unit: UnitTemperature.celsius)
            .formatted(
                .measurement(width: .abbreviated, usage: .weather, numberFormatStyle: .number.precision(.fractionLength(0)))
                    .locale(locale)
            )
    }

    /// One temperature the way Weather writes it: "9°".
    public static func degrees(c: Double, locale: Locale = .current) -> String {
        Measurement(value: c, unit: UnitTemperature.celsius)
            .formatted(.measurement(width: .narrow, usage: .weather, numberFormatStyle: .number.precision(.fractionLength(0))).locale(locale))
            // The narrow style still appends "C"/"F" in some locales; Weather drops it.
            .trimmingCharacters(in: CharacterSet(charactersIn: "CF"))
    }

    /// A temperature range the way Weather writes it: "9–14°".
    public static func temperatureRange(c range: ClosedRange<Double>, locale: Locale = .current) -> String {
        let lower = degrees(c: range.lowerBound, locale: locale).trimmingCharacters(in: CharacterSet(charactersIn: "°"))
        return "\(lower)–\(degrees(c: range.upperBound, locale: locale))"
    }

    /// Wind/cruising speed: km/h (metric) or mph (imperial).
    public static func speed(kph: Double, system: UnitSystem, fractionDigits: Int = 0, locale: Locale = .current) -> String {
        let measurement = Measurement(value: kph, unit: UnitSpeed.kilometersPerHour)
        return (system == .metric ? measurement : measurement.converted(to: .milesPerHour))
            .formatted(
                .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(fractionDigits)))
                    .locale(locale)
            )
    }

    // ponytail: strips the leading number/punctuation/whitespace off a
    // formatted "1 unit" string to recover just the symbol, rather than a
    // second Measurement API for "give me the resolved unit" (none exists
    // publicly). Only used for the two axis-label helpers above.
    private static func unitSymbol(from formatted: String) -> String {
        var strip = CharacterSet.decimalDigits
        strip.formUnion(.whitespaces)
        strip.formUnion(CharacterSet(charactersIn: ".,"))
        return formatted.trimmingCharacters(in: strip)
    }
}

public extension FormatStyle where Self == Date.FormatStyle {
    /// Ride times as the canvas writes them: "09:00" (en-GB), "09:00 AM" (en-US).
    static var clockTime: Date.FormatStyle { .dateTime.hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits) }
}

public extension EnvironmentValues {
    /// The rider's distance and elevation units, injected at the app root from
    /// `PreferencesStore` — views read this and pass it to `UnitFormat`.
    @Entry var unitSystem: UnitSystem = .localeDefault
    /// The rider's wind and riding speed units, saved separately from distance.
    @Entry var speedSystem: UnitSystem = .localeDefault
}

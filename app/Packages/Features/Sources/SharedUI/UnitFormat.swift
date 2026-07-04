import SwiftUI
import Models

/// Display-only unit formatting. Canonical storage/engine values stay metric
/// everywhere else (distanceKm, elevationGainM, windKph, temperatureC,
/// speed km/h) — this converts for display per the rider's `UnitSystem`
/// (You tab / macOS Settings; defaults from the locale, UK = metric).
/// Temperature is the exception: it keeps following the locale, which iOS
/// exposes as a per-app °C/°F override.
public enum UnitFormat {
    /// Ride distance: km (metric) or miles (imperial).
    public static func distance(km: Double, system: UnitSystem, locale: Locale = .current) -> String {
        let measurement = Measurement(value: km, unit: UnitLength.kilometers)
        return (system == .metric ? measurement : measurement.converted(to: .miles))
            .formatted(
                .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(1)))
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

    /// Wind/cruising speed: km/h (metric) or mph (imperial).
    public static func speed(kph: Double, system: UnitSystem, locale: Locale = .current) -> String {
        let measurement = Measurement(value: kph, unit: UnitSpeed.kilometersPerHour)
        return (system == .metric ? measurement : measurement.converted(to: .milesPerHour))
            .formatted(
                .measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(0)))
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

public extension EnvironmentValues {
    /// The rider's display units, injected at the app root from
    /// `PreferencesStore` — views read this and pass it to `UnitFormat`.
    @Entry var unitSystem: UnitSystem = .localeDefault
}

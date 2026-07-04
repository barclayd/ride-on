import Foundation

/// Display-only unit formatting. Canonical storage/engine values stay metric
/// everywhere else (distanceKm, elevationGainM, windKph, temperatureC,
/// speed km/h) — this just picks the right unit for the locale via
/// `Measurement.formatted`. No in-app toggle: users override via system
/// Settings > Language & Region.
public enum UnitFormat {
    /// Road distance: miles in US/UK locales, km elsewhere (`usage: .road`).
    public static func distance(km: Double, locale: Locale = .current) -> String {
        Measurement(value: km, unit: UnitLength.kilometers)
            .formatted(
                .measurement(width: .abbreviated, usage: .road, numberFormatStyle: .number.precision(.fractionLength(1)))
                    .locale(locale)
            )
    }

    /// Just the distance unit symbol ("mi"/"km") for the given locale —
    /// for chart axis labels, not a value.
    public static func distanceUnitSymbol(locale: Locale = .current) -> String {
        unitSymbol(from: distance(km: 1, locale: locale))
    }

    /// Elevation: feet in US/UK locales, meters elsewhere (`usage: .general`
    /// — verified over `.asProvided`/`.personHeight` to give a plain whole
    /// unit, not a compound "ft, in" string).
    public static func elevation(m: Double, locale: Locale = .current) -> String {
        Measurement(value: m, unit: UnitLength.meters)
            .formatted(
                .measurement(width: .abbreviated, usage: .general, numberFormatStyle: .number.precision(.fractionLength(0)))
                    .locale(locale)
            )
    }

    /// Just the elevation unit symbol ("ft"/"m") for the given locale — for
    /// chart axis labels, not a value.
    public static func elevationUnitSymbol(locale: Locale = .current) -> String {
        unitSymbol(from: elevation(m: 1, locale: locale))
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

    /// Wind/cruising speed: km/h vs mph.
    public static func speed(kph: Double, locale: Locale = .current) -> String {
        Measurement(value: kph, unit: UnitSpeed.kilometersPerHour)
            .formatted(
                .measurement(width: .abbreviated, usage: .general, numberFormatStyle: .number.precision(.fractionLength(0)))
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

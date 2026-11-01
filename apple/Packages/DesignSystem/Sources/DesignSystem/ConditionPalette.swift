import SwiftUI

/// The fixed temperature/severity ramp shared by condition chips, the 10-day
/// "best day" markers, and factor range bars. DESIGN-SYSTEM.md §3: the only
/// custom color palette in the app — chips must still differ by SF Symbol,
/// never color alone.
public enum ConditionPalette {
    /// The one score→color band mapping (0...1) shared by ScoreRing and
    /// FactorRow's RangeBar — previously two per-view variants that disagreed
    /// on the middle band.
    public static func color(forScore score: Double) -> Color {
        switch score {
        case 0.7...: .green
        case 0.4..<0.7: .yellow
        default: .red
        }
    }

    /// Deep blue < 0C -> light blue -> green -> yellow -> orange -> red > 30C.
    public static func color(forTemperatureC celsius: Double) -> Color {
        switch celsius {
        case ..<0: Color(red: 0.05, green: 0.15, blue: 0.55)
        case 0..<10: Color(red: 0.4, green: 0.7, blue: 1.0)
        case 10..<18: .green
        case 18..<24: .yellow
        case 24..<30: .orange
        default: .red
        }
    }
}

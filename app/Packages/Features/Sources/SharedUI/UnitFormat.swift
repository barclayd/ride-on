import SwiftUI
import Models

// `UnitFormat` and `.clockTime` live in Models, so the widget extension can share them.

public extension EnvironmentValues {
    /// The rider's distance and elevation units, injected at the app root from
    /// `PreferencesStore` — views read this and pass it to `UnitFormat`.
    @Entry var unitSystem: UnitSystem = .localeDefault
    /// The rider's wind and riding speed units, saved separately from distance.
    @Entry var speedSystem: UnitSystem = .localeDefault
}

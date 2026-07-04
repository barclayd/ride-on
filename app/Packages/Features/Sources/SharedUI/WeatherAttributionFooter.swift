import SwiftUI
import Services

/// Not a §6 component — the mandatory WeatherKit attribution mark
/// (DESIGN-SYSTEM.md §9), shown in the breakdown sheet footer and You → About.
public struct WeatherAttributionFooter: View {
    public init() {}

    public var body: some View {
        Link(destination: WeatherAttribution.legalPageURL) {
            HStack(spacing: 4) {
                Image(systemName: "cloud.sun")
                Text(WeatherAttribution.label)
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

import Foundation

/// Apple's WeatherKit attribution requirement — mandatory wherever WeatherKit
/// data appears in the UI (DESIGN-SYSTEM.md §9): factor breakdown sheet
/// footer, You → About.
///
/// ponytail: static values, not a live `WeatherService.shared.attribution`
/// call. Weather is fixture-backed until Phase 6's real WeatherKit client
/// lands; swap this for the real (async, locale-aware) attribution fetch
/// then — the UI already reads through this one seam.
public enum WeatherAttribution {
    public static let label = "Weather"
    public static let legalPageURL = URL(string: "https://weatherkit.apple.com/legal-attribution.html")!
}

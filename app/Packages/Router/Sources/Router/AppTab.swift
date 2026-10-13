import Foundation

/// Tab metadata only — no view construction here. The App shell owns the
/// switch from tab to concrete Feature view (it's the one target allowed to
/// import every Features product); Router just needs to be importable by
/// anything that wants to render tab chrome (labels, selection state)
/// without depending on the UI packages themselves.
public enum AppTab: String, CaseIterable, Identifiable, Sendable {
    case rides, routes, preferences

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .rides: "Rides"
        case .routes: "Routes"
        case .preferences: "Preferences"
        }
    }

    public var systemImage: String {
        switch self {
        case .rides: "bicycle"
        case .routes: "map"
        case .preferences: "slider.horizontal.3"
        }
    }
}

import Foundation

/// Tab metadata only — no view construction here. The App shell owns the
/// switch from tab to concrete Feature view (it's the one target allowed to
/// import every Features product); Router just needs to be importable by
/// anything that wants to render tab chrome (labels, selection state)
/// without depending on the UI packages themselves.
public enum AppTab: String, CaseIterable, Identifiable, Sendable {
    case today, routes, you

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .today: "Today"
        case .routes: "Routes"
        case .you: "You"
        }
    }

    public var systemImage: String {
        switch self {
        case .today: "bicycle"
        case .routes: "map"
        case .you: "person.crop.circle"
        }
    }
}

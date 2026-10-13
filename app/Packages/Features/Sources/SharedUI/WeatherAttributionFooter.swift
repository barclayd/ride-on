import SwiftUI
import Services

/// Not a §6 component — the WeatherKit attribution every forecast screen must show:
/// "Apple Weather · Other data sources".
public struct WeatherAttributionFooter: View {
    public init() {}

    public var body: some View {
        Text(Self.attribution)
            .font(.caption)
            .foregroundStyle(.secondary)
            .tint(.secondary)
    }

    private static let attribution: AttributedString = {
        var text = AttributedString("Apple Weather")
        text.inlinePresentationIntent = .stronglyEmphasized
        text.foregroundColor = .primary
        var link = AttributedString("Other data sources")
        link.link = WeatherAttribution.legalPageURL
        link.underlineStyle = .single
        return text + AttributedString(" · ") + link
    }()
}

import PlatformServices
import SwiftUI
import Domain
import Services

/// Not a §6 component — the forecast provider's attribution every forecast screen must show:
/// "Apple Weather · Other data sources", or the provider's own line, such as "Powered by Met Office data".
public struct WeatherAttributionFooter: View {
    var credits: [RideBoard.Credit]

    /// No credits means Apple Weather, the app's own forecasts.
    public init(_ credits: [RideBoard.Credit] = []) {
        self.credits = credits
    }

    public var body: some View {
        Text(credits.isEmpty ? Self.apple(WeatherAttribution.legalPageURL) : credits.map(Self.line).reduce(AttributedString(), Self.join))
            .font(.caption)
            .foregroundStyle(.secondary)
            .tint(.secondary)
    }

    // ponytail: Apple is matched by its attribution text, the only way the API names it in `weather.attribution`.
    private static func line(_ credit: RideBoard.Credit) -> AttributedString {
        if credit.text == "Apple Weather" { return apple(credit.url) }
        var text = AttributedString(credit.text)
        text.link = credit.url
        text.underlineStyle = .single
        return text
    }

    private static func join(_ lines: AttributedString, _ line: AttributedString) -> AttributedString {
        lines.characters.isEmpty ? line : lines + AttributedString(" · ") + line
    }

    private static func apple(_ legalPage: URL) -> AttributedString {
        var text = AttributedString("Apple Weather")
        text.inlinePresentationIntent = .stronglyEmphasized
        text.foregroundColor = .primary
        var link = AttributedString("Other data sources")
        link.link = legalPage
        link.underlineStyle = .single
        return text + AttributedString(" · ") + link
    }
}

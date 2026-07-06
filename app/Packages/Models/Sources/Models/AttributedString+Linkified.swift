import Foundation

public extension AttributedString {
    /// Turns free text into an `AttributedString` with any bare URLs / emails
    /// made into tappable links — for user-authored route descriptions.
    ///
    /// ponytail: `NSDataDetector` (the same engine `UITextView`'s link
    /// detection uses), not a markdown/rich-text editor — skipped `[label](url)`
    /// support, add if users ask for labelled links. Lives in Models rather
    /// than SharedUI because it's platform-free Foundation and unit-tested in
    /// ModelsTests.
    static func linkified(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        guard !text.isEmpty,
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return attributed
        }
        let fullRange = NSRange(text.startIndex..., in: text)
        for match in detector.matches(in: text, range: fullRange) {
            guard let url = match.url, let range = Range(match.range, in: text) else { continue }
            // Map the String (Character) range onto the AttributedString by
            // Character offsets — consistent counting keeps multibyte/emoji safe.
            let lower = attributed.index(attributed.startIndex, offsetByCharacters: text.distance(from: text.startIndex, to: range.lowerBound))
            let upper = attributed.index(lower, offsetByCharacters: text.distance(from: range.lowerBound, to: range.upperBound))
            attributed[lower..<upper].link = url
        }
        return attributed
    }
}

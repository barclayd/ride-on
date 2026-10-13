import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// DESIGN-SYSTEM.md §3 status colours and the §5 grouped surfaces. The accent
/// is the asset catalog's `AccentColor`, not here.
public extension ShapeStyle where Self == Color {
    /// "Below your minimums". Always paired with a warning symbol and words.
    static var belowMinimums: Color { Color(light: 0xB23A00, dark: 0xFF9F0A) }
    /// Rain chance.
    static var rain: Color { Color(light: 0x0A66D8, dark: 0x64B5FF) }

    /// Route thumbnails: the land behind the outline and the outline's casing (the canvas's
    /// map palette).
    static var routeLand: Color { Color(light: 0xF1EEE6, dark: 0x2C2C2E) }
    static var routeCasing: Color { Color(light: 0xFFFFFF, dark: 0x48484A) }

    /// The screen behind the cards.
    static var groupedBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemGroupedBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    /// Solid cards and rows (never glass, §2).
    static var cardBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemGroupedBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }
}

extension Color {
    /// A light/dark pair from two `0xRRGGBB` values.
    init(light: UInt32, dark: UInt32) {
        func rgb(_ hex: UInt32) -> (CGFloat, CGFloat, CGFloat) {
            (CGFloat(hex >> 16 & 0xFF) / 255, CGFloat(hex >> 8 & 0xFF) / 255, CGFloat(hex & 0xFF) / 255)
        }
        let (lr, lg, lb) = rgb(light), (dr, dg, db) = rgb(dark)
        #if canImport(UIKit)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: dr, green: dg, blue: db, alpha: 1)
                : UIColor(red: lr, green: lg, blue: lb, alpha: 1)
        })
        #else
        self.init(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: dr, green: dg, blue: db, alpha: 1)
                : NSColor(srgbRed: lr, green: lg, blue: lb, alpha: 1)
        })
        #endif
    }
}

import SwiftUI

/// DESIGN-SYSTEM.md §5: corner radii are never hard-coded — every rounded
/// shape picks a semantic token here (Landmarks' `Constants.swift` idiom).
public enum CornerRadius {
    /// Full-bleed content cards (RideCard, the rest-day card).
    public static let card: CGFloat = 24
    /// The Routes panel floating over the map.
    public static let floatingPanel: CGFloat = 34
    /// A selected row inside the Routes panel.
    public static let selectedRow: CGFloat = 22
    /// Hero imagery (Route Detail map).
    public static let hero: CGFloat = 20
    /// Inline panels over ambiance backgrounds (onboarding speed prefill).
    public static let panel: CGFloat = 16
    /// Small badges (BestDayBadge).
    public static let badge: CGFloat = 14
    /// List-row thumbnails.
    public static let thumbnail: CGFloat = 8
    /// Route thumbnails in the Routes panel's rows.
    public static let panelThumbnail: CGFloat = 11
}

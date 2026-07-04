import SwiftUI

public extension View {
    /// The small trailing metadata capsule used on list rows (route type,
    /// ride-log source). A styling helper, not a DESIGN-SYSTEM.md §6
    /// component — the closed inventory covers named custom views, not
    /// modifier chains over stock `Text`.
    func tagCapsule() -> some View {
        font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.secondary.opacity(0.15), in: .capsule)
    }
}

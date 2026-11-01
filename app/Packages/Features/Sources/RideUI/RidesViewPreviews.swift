import SwiftUI
import Models
import Services
import DesignSystem

// In their own file: Xcode's preview thunks can't compile RidesView.swift itself.

#Preview {
    NavigationStack {
        RidesView(board: .sample)
    }
    .environment(RideTracker(live: false))
}

// The iPhone Duo's poses beside the rail (PaneShape), for the canvas: the simulator can't fold.
#Preview("Tent", traits: .fixedLayout(width: 606, height: 466)) {
    NavigationStack { RidesView(board: .sample) }
        .measuresPaneShape()
        .environment(RideTracker(live: false))
}

#Preview("Open, landscape", traits: .fixedLayout(width: 879, height: 669)) {
    NavigationStack { RidesView(board: .sample) }
        .measuresPaneShape()
        .environment(RideTracker(live: false))
}

#Preview("Open, landscape, Ride Window", traits: .fixedLayout(width: 879, height: 669)) {
    NavigationStack { RidesView(board: .sample, choosingWindow: true) }
        .measuresPaneShape()
        .environment(RideTracker(live: false))
}

#Preview("Open, portrait", traits: .fixedLayout(width: 669, height: 951)) {
    NavigationStack { RidesView(board: .sample) }
        .measuresPaneShape()
        .environment(RideTracker(live: false))
}

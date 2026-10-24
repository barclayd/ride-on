import SwiftUI
import WidgetKit
import AppIntents
import Models
import DesignSystem

/// The Control Centre control (docs/redesign/README.md §8): the tracked ride, or Track Best.
struct RideControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "RideControl", provider: Provider()) { name in
            ControlWidgetButton(action: OpenRideIntent()) {
                if let name {
                    Label(name, systemImage: "bell.fill")
                } else {
                    Label("Track Best", systemImage: "bell")
                }
            }
            .tint(name == nil ? Color.accentColor : .committed)
        }
        .displayName("Ride On")
        .description("Open the ride you're tracking, or track the best one.")
    }

    /// The tracked ride's name.
    struct Provider: ControlValueProvider {
        let previewValue: String? = nil

        func currentValue() async throws -> String? {
            WidgetStore.load()?.trackedRide(at: .now)?.ride.name
        }
    }
}

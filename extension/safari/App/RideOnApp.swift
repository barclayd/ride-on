import SwiftUI
#if os(macOS)
import SafariServices
#endif

@main
struct RideOnApp: App {
    var body: some Scene {
        WindowGroup { EnableGuide() }
        #if os(macOS)
            .windowResizability(.contentSize)
        #endif
    }
}

/// Safari extensions ship inside an app; this one explains how to turn Ride On on.
struct EnableGuide: View {
    #if os(macOS)
    private let extensionID = "com.danbarclay.rideon.Extension"
    @State private var isOn: Bool?
    @Environment(\.scenePhase) private var scenePhase
    private let steps: [LocalizedStringKey] = [
        "Open **Safari Settings → Extensions** and tick **Ride On**.",
        "Click **Ride On** in Safari's toolbar and sign in with Google or Apple. Allow it on **cycle.travel** and **api.ride-on.cc** when Safari asks.",
        "Track routes on your cycle.travel journeys page. Ride On picks the best one, and the best time to ride it.",
    ]
    #else
    private let steps: [LocalizedStringKey] = [
        "Open **Settings → Apps → Safari → Extensions**, choose **Ride On** and turn on **Allow Extension**.",
        "In Safari, tap the extensions button in the address bar, choose **Ride On** and sign in with Google or Apple. Allow it on **cycle.travel** and **api.ride-on.cc** when asked.",
        "Track routes on your cycle.travel journeys page. Ride On picks the best one, and the best time to ride it.",
    ]
    #endif

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ride On for Safari").font(.largeTitle.bold())
                    Text("Pick the best of your saved cycle.travel routes, and the best time to ride it.")
                        .foregroundStyle(.secondary)
                }
                #if os(macOS)
                HStack {
                    if let isOn {
                        Label(
                            isOn ? "Ride On is on in Safari." : "Ride On is off in Safari.",
                            systemImage: isOn ? "checkmark.circle.fill" : "circle.dashed"
                        )
                    }
                    Spacer()
                    Button("Open Safari Settings…") {
                        Task { try? await SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID) }
                    }
                    .buttonStyle(.borderedProminent)
                }
                #endif
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(steps.indices, id: \.self) { index in
                        Label { Text(steps[index]) } icon: {
                            Image(systemName: "\(index + 1).circle.fill").foregroundStyle(.tint)
                        }
                    }
                }
                Link("Open cycle.travel", destination: URL(string: "https://cycle.travel/user/journeys")!)
            }
            .padding(32)
            .frame(maxWidth: 560, alignment: .leading)
        }
        #if os(macOS)
        // Coming back from Safari Settings refreshes the status.
        .task(id: scenePhase) {
            isOn = try? await SFSafariExtensionManager.stateOfSafariExtension(withIdentifier: extensionID).isEnabled
        }
        #endif
    }
}

import SwiftUI

/// Not a §6 component — a plain, reusable "priming" explainer shown
/// immediately before a system permission prompt (DESIGN-SYSTEM.md §9:
/// "permissions primed contextually with one-sentence explainer immediately
/// before each system sheet... never all upfront"). Presented as a system
/// sheet (glass for free, §2). Real CoreLocation/HealthKit authorization
/// requests are wired in Phase 6 — this is the priming UI plus the "primed"
/// bookkeeping (`PreferencesStore.hasPrimedLocationPermission` /
/// `hasPrimedHealthPermission`) only.
public struct PermissionPrimingSheet: View {
    public var symbol: String
    public var title: String
    public var message: String
    public var allowTitle: String
    public var onAllow: () -> Void
    public var onNotNow: () -> Void

    public init(
        symbol: String,
        title: String,
        message: String,
        allowTitle: String = "Allow",
        onAllow: @escaping () -> Void,
        onNotNow: @escaping () -> Void
    ) {
        self.symbol = symbol
        self.title = title
        self.message = message
        self.allowTitle = allowTitle
        self.onAllow = onAllow
        self.onNotNow = onNotNow
    }

    public var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text(title)
                .font(.title2.bold())
            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Spacer(minLength: 8)

            Button(allowTitle, action: onAllow)
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
            Button("Not Now", action: onNotNow)
                .buttonStyle(.glass)
                .frame(maxWidth: .infinity)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .presentationDetents([.medium])
    }
}

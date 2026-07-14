import Foundation
import SwiftData
import Models

/// Central `ModelContainer` factory. CloudKit-mirrored in Release; in-memory
/// (no on-disk store, no CloudKit) for Debug builds and `--fixture-world`
/// runs. Every build carries the iCloud entitlement (CLAUDE.md "Signing"),
/// so in-memory configs opt out of mirroring explicitly below.
public enum RideOnModelContainer {
    public static let schema = Schema([RouteModel.self, RideLogModel.self, SavedPlaceModel.self])

    public static func make() -> ModelContainer {
        let configuration: ModelConfiguration
        // In-memory configs must pass `cloudKitDatabase: .none` explicitly —
        // the default is `.automatic`, which engages CloudKit mirroring
        // whenever the build carries the iCloud entitlement (all builds do
        // since the PLA unblock), and CoreData's mirroring delegate on an
        // in-memory store hangs/crashes at first insert.
        #if DEBUG
        configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)
        #else
        if FixtureWorld.isEnabled {
            configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)
        } else {
            configuration = ModelConfiguration(schema: schema, cloudKitDatabase: .automatic)
        }
        #endif
        // A schema/configuration mismatch here is a programmer error (bad
        // migration, conflicting config), not a runtime condition to
        // recover from — crashing loudly beats silently running with no
        // persistence.
        return try! ModelContainer(for: schema, configurations: [configuration])
    }

    /// A fresh in-memory container, for tests and previews.
    public static func inMemory() -> ModelContainer {
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)
        return try! ModelContainer(for: schema, configurations: [configuration])
    }
}

import Foundation
import SwiftData
import Models

/// Central `ModelContainer` factory. On-disk + CloudKit-mirrored
/// (`iCloud.com.danbarclay.rideon` private database) for every real run —
/// Debug included, since every build carries the iCloud entitlement
/// (CLAUDE.md "Signing"). Only `--fixture-world` runs (E2E) get in-memory,
/// keeping tests deterministic and off the network per PLAN.md.
public enum RideOnModelContainer {
    public static let schema = Schema([RouteModel.self, RideLogModel.self, SavedPlaceModel.self])

    public static func make() -> ModelContainer {
        let configuration: ModelConfiguration
        if FixtureWorld.isEnabled {
            // In-memory configs must pass `cloudKitDatabase: .none` explicitly —
            // the default is `.automatic`, which engages CloudKit mirroring
            // whenever the build carries the iCloud entitlement (all builds do),
            // and CoreData's mirroring delegate on an in-memory store
            // hangs/crashes at first insert.
            configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)
        } else {
            configuration = ModelConfiguration(schema: schema, cloudKitDatabase: .automatic)
        }
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

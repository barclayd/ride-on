import Foundation
import SwiftData
import Models

/// Central `ModelContainer` factory. CloudKit-mirrored in Release; in-memory
/// (no entitlements, no on-disk store) for Debug builds and `--fixture-world`
/// runs, per CLAUDE.md's signing note — Debug never carries the
/// iCloud/CloudKit entitlement, so a real CloudKit-backed store would just
/// fail to initialize there.
public enum RideOnModelContainer {
    public static let schema = Schema([RouteModel.self, RideLogModel.self, SavedPlaceModel.self])

    public static func make() -> ModelContainer {
        let configuration: ModelConfiguration
        #if DEBUG
        configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        #else
        if FixtureWorld.isEnabled {
            configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
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
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        return try! ModelContainer(for: schema, configurations: [configuration])
    }
}

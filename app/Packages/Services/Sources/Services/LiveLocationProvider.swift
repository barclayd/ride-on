import Foundation
import CoreLocation
import Models

/// One-shot device location via `CLLocationUpdate.liveUpdates()` — the
/// async-sequence API, no delegate state machine. Starting the sequence
/// triggers the system when-in-use prompt when authorization is
/// undetermined, so `requestingPermissionIfNeeded: false` callers bail out
/// before touching it and the prompt only ever appears from the priming
/// flow's `true` call.
public struct LiveLocationProvider: LocationProviding {
    public init() {}

    public func currentLocation(requestingPermissionIfNeeded: Bool) async -> Coordinate? {
        let status = CLLocationManager().authorizationStatus
        switch status {
        case .denied, .restricted:
            return nil
        case .notDetermined where !requestingPermissionIfNeeded:
            return nil
        default:
            break
        }

        do {
            for try await update in CLLocationUpdate.liveUpdates() {
                if let location = update.location {
                    return Coordinate(
                        latitude: location.coordinate.latitude,
                        longitude: location.coordinate.longitude
                    )
                }
                if update.authorizationDenied || update.authorizationRestricted {
                    return nil
                }
            }
        } catch {
            return nil
        }
        return nil
    }
}

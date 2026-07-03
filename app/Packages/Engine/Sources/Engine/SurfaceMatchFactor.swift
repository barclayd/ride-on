import Foundation
import Models

/// Surface/bike match: how well the rider's chosen `Bike` suits the route's
/// surface breakdown. Road bikes are penalized by unpaved/path share; MTBs
/// are mildly penalized on heavily-paved routes (overkill, not unsafe);
/// gravel bikes are comfortable on nearly everything.
public struct SurfaceMatchFactor: FactorScoring {
    public init() {}

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let shares = route.surfaces.shareBySurface
        let unpavedShare = (shares[.unpaved] ?? 0) + (shares[.path] ?? 0)
        let pavedShare = (shares[.paved] ?? 0) + (shares[.busyRoad] ?? 0)
        let unpavedPercent = Int((unpavedShare * 100).rounded())

        let value: Double
        let reason: String
        switch context.bike.type {
        case .road:
            value = max(0, 1 - unpavedShare * 1.5)
            reason = unpavedShare > 0.15
                ? "\(unpavedPercent)% unpaved — tough on a road bike."
                : "Mostly paved — good fit for your road bike."
        case .gravel:
            value = max(0, 1 - unpavedShare * 0.1)
            reason = "Gravel bike handles this route's surface mix fine."
        case .mtb:
            value = max(0.6, 1 - pavedShare * 0.3)
            reason = pavedShare > 0.7
                ? "Mostly paved — your MTB will feel like overkill here."
                : "Good technical terrain for your MTB."
        }

        return FactorScore(factor: .surfaceMatch, value: value, reason: reason)
    }
}

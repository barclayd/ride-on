import Foundation
import Models

/// Training-intent fit: does this route's distance/elevation suit an easy
/// spin, a training push, or an exploring ride (where effort isn't the
/// point — novelty and time-budget carry that intent instead)?
public struct IntentFactor: FactorScoring {
    public init() {}

    public func score(route: Route, context: DailyContext) -> FactorScore {
        let gainPerKm = route.distanceKm > 0 ? route.elevationGainM / route.distanceKm : 0
        let distanceKm = Int(route.distanceKm.rounded())
        let gainM = Int(route.elevationGainM.rounded())

        let value: Double
        let reason: String
        switch context.intent {
        case .easy:
            let distancePenalty = max(0, (route.distanceKm - 25) / 40)
            let climbPenalty = max(0, (gainPerKm - 8) / 15)
            value = max(0, 1 - distancePenalty - climbPenalty)
            reason = value >= 0.7
                ? "\(distanceKm)km, \(gainM)m climbing — an easy-paced fit."
                : "\(distanceKm)km, \(gainM)m climbing — more than an easy spin."
        case .training:
            let distanceBonus = min(1, route.distanceKm / 60)
            let climbBonus = min(1, gainPerKm / 20)
            value = 0.3 + 0.7 * ((distanceBonus + climbBonus) / 2)
            reason = value >= 0.7
                ? "\(distanceKm)km, \(gainM)m climbing — good training load."
                : "\(distanceKm)km, \(gainM)m climbing — a light day for training."
        case .exploring:
            value = 0.75
            reason = "\(distanceKm)km, \(gainM)m climbing — distance isn't the focus for exploring."
        }

        return FactorScore(factor: .intent, value: value, reason: reason)
    }
}

import Foundation

// TODO(Phase 3): replace each of these with real logic against WeatherKit
// data / route geometry. Neutral 0.5 keeps `WeightedScorer` runnable
// end-to-end until then.

public struct WindFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .wind, value: 0.5, reason: "Wind scoring not implemented yet.")
    }
}

public struct TemperatureFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .temperature, value: 0.5, reason: "Temperature scoring not implemented yet.")
    }
}

public struct SkyFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .sky, value: 0.5, reason: "Sky scoring not implemented yet.")
    }
}

public struct RainFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .rain, value: 0.5, reason: "Rain scoring not implemented yet.")
    }
}

public struct SurfaceMatchFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .surfaceMatch, value: 0.5, reason: "Surface match scoring not implemented yet.")
    }
}

public struct IntentFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .intent, value: 0.5, reason: "Intent scoring not implemented yet.")
    }
}

public struct NoveltyFactor: FactorScoring {
    public init() {}
    public func score(route: Route, context: DailyContext) -> FactorScore {
        FactorScore(factor: .novelty, value: 0.5, reason: "Novelty scoring not implemented yet.")
    }
}

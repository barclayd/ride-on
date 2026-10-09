/**
 * Internal provider boundary; see docs/weather-providers.md.
 * Provider adapters are independent of HTTP endpoint wiring and scoring.
 * Keep provider payloads, credentials and platform bindings outside these types.
 */
export type Coordinate = Readonly<{ latitude: number; longitude: number }>;

/** ISO 8601 UTC instants; adapters must validate ordering and finite values. */
export type TimeRange = Readonly<{ start: string; end: string }>;

export type RequestedLocation = Readonly<{
  id: string;
  coordinate: Coordinate;
}>;

export type ResolvedLocation = Readonly<{
  requested: RequestedLocation;
  coordinate: Coordinate;
  sourceLocationId: string | null;
  distanceFromRequestedM: number;
  method: 'nearest-site' | 'grid-cell' | 'interpolated' | 'exact';
}>;

export type SourceIdentity = Readonly<{
  /** Open identifiers: adding a provider does not change the scoring engine. */
  providerId: string;
  productId: string;
  adapterVersion: string;
}>;

export type Provenance = Readonly<{
  source: SourceIdentity;
  /** Upstream run/instance/dataset version, not an invented timestamp. */
  dataVersion: string | null;
  /** Forecast model run used for freshness; absent for non-forecast datasets. */
  forecastRunAt?: string;
  retrievedAt: string;
  attribution: readonly Readonly<{ text: string; url: string }>[];
}>;

/** Canonical units. Rain and all precipitation are deliberately distinct. */
export type WeatherMeasure =
  | Readonly<{
      quantity: 'air-temperature' | 'feels-like-temperature';
      unit: 'celsius';
    }>
  | Readonly<{ quantity: 'wind-speed' | 'wind-gust'; unit: 'm/s' }>
  | Readonly<{
      quantity: 'wind-from-direction';
      /** Meteorological direction FROM true north, clockwise in [0, 360). */
      unit: 'degrees';
    }>
  | Readonly<{
      quantity: 'rainfall-amount' | 'precipitation-amount';
      unit: 'mm';
    }>
  | Readonly<{
      quantity: 'rainfall-rate' | 'precipitation-rate';
      unit: 'mm/h';
    }>;

export type ProbabilityEvent =
  | Readonly<{
      kind: 'threshold';
      measure: WeatherMeasure;
      comparison: 'above' | 'at-or-above' | 'below' | 'at-or-below';
      threshold: number;
    }>
  | Readonly<{
      /** Preserve a provider-defined occurrence event with no numeric threshold. */
      kind: 'occurrence';
      phenomenon: 'rain' | 'precipitation';
      definition: string;
    }>;

export type ForecastDescriptor =
  | Readonly<{
      kind: 'scalar';
      measure: WeatherMeasure;
      statistic:
        | Readonly<{ kind: 'deterministic' }>
        /** Percentile in [0, 100], not a probability of the forecast scenario. */
        | Readonly<{ kind: 'percentile'; percentile: number }>;
    }>
  | Readonly<{
      kind: 'probability';
      event: ProbabilityEvent;
      /** Probability in [0, 1]; applies only to this sample's event and time. */
      unit: 'fraction';
    }>;

export type SampleTime =
  | Readonly<{ kind: 'instant'; at: string }>
  | Readonly<{
      kind: 'period';
      range: TimeRange;
      aggregation: 'mean' | 'minimum' | 'maximum' | 'accumulation' | 'event';
    }>;

export type ForecastSample = Readonly<{
  /** Provider's validity/label time, distinct from the bounds of a statistic. */
  validAt: string;
  time: SampleTime;
  /** Null is unavailable, never dry/calm/comfortable by default. */
  value: number | null;
}>;

export type ForecastSeries = Readonly<{
  descriptor: ForecastDescriptor;
  /** Sorted by valid time; preserve native intervals instead of inventing hours. */
  samples: readonly ForecastSample[];
}>;

export type ForecastRequest = Readonly<{
  locations: readonly RequestedLocation[];
  range: TimeRange;
  required: readonly ForecastDescriptor[];
  maxTimeStepSeconds: number;
  maxLocationDistanceM: number;
  /** Maximum age of the upstream model run, not time since retrieval. */
  maxAgeSeconds: number;
}>;

export type ProviderIssue = Readonly<{
  code:
    | 'invalid-request'
    | 'not-configured'
    | 'unauthorized'
    | 'rate-limited'
    | 'timeout'
    | 'cancelled'
    | 'upstream-unavailable'
    | 'invalid-response'
    | 'unsupported-variable'
    | 'unsupported-statistic'
    | 'outside-coverage'
    | 'outside-forecast-horizon'
    | 'insufficient-resolution'
    | 'missing-data'
    | 'stale-data';
  /** Sanitized; no credentials or raw upstream response bodies. */
  message: string;
  retryAfterSeconds?: number;
}>;

export type LocationForecastResult =
  | Readonly<{
      status: 'complete' | 'partial';
      location: ResolvedLocation;
      provenance: Provenance;
      issuedAt: string | null;
      series: readonly ForecastSeries[];
      issues: readonly ProviderIssue[];
    }>
  | Readonly<{
      status: 'unavailable';
      requested: RequestedLocation;
      source: SourceIdentity;
      issues: readonly [ProviderIssue, ...ProviderIssue[]];
    }>;

export type ForecastCapabilities = Readonly<{
  available: readonly Readonly<{
    descriptor: ForecastDescriptor;
    timeStepSeconds: number;
    /** Nominal product horizon; actual coverage is checked on every result. */
    forecastHorizonSeconds: number;
  }>[];
  maxLocationsPerUpstreamRequest: number;
}>;

/** Factories return plain objects of functions; no inheritance or SDK leakage. */
export type ForecastProvider = Readonly<{
  source: SourceIdentity;
  getCapabilities: (signal: AbortSignal) => Promise<ForecastCapabilities>;
  /** Return exactly one result per requested ID, including location failures. */
  getForecast: (
    request: ForecastRequest,
    signal: AbortSignal,
  ) => Promise<readonly LocationForecastResult[]>;
}>;

/** Region/profile rules resolve to one of these policies before provider calls. */
export type WeatherSourcePolicy =
  | Readonly<{ mode: 'strict'; providerId: string }>
  | Readonly<{
      mode: 'ordered-fallback';
      /** The user-authorized list is exhaustive and ordered; never race to win. */
      providerIds: readonly [string, ...string[]];
    }>;

export type ClimateNormalsRequest = Readonly<{
  locations: readonly RequestedLocation[];
  months: readonly number[];
  referencePeriod: Readonly<{ startYear: number; endYear: number }>;
  maxLocationDistanceM: number;
}>;

export type LocationClimateNormalsResult =
  | Readonly<{
      status: 'complete' | 'partial';
      location: ResolvedLocation;
      provenance: Provenance;
      referencePeriod: Readonly<{ startYear: number; endYear: number }>;
      statistic: 'monthly-mean-of-daily-maximum-temperature';
      values: readonly Readonly<{
        month: number;
        temperatureC: number | null;
      }>[];
      issues: readonly ProviderIssue[];
    }>
  | Readonly<{
      status: 'unavailable';
      requested: RequestedLocation;
      source: SourceIdentity;
      issues: readonly [ProviderIssue, ...ProviderIssue[]];
    }>;

/** Climate baselines are historical data, with separate provenance and caching. */
export type ClimateNormalsProvider = Readonly<{
  source: SourceIdentity;
  getNormals: (
    request: ClimateNormalsRequest,
    signal: AbortSignal,
  ) => Promise<readonly LocationClimateNormalsResult[]>;
}>;

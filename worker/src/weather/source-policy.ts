import type {
  ForecastProvider,
  ForecastRequest,
  LocationForecastResult,
  SourceIdentity,
  WeatherSourcePolicy,
} from './contracts.ts';

type Attempt = Readonly<{
  source: SourceIdentity;
  status: 'complete' | 'partial' | 'unavailable';
}>;
export type SelectedForecast = Readonly<{
  source: SourceIdentity;
  results: readonly LocationForecastResult[];
  attempts: readonly Attempt[];
}>;

/** One source per comparison. Only an explicitly listed provider can be tried. */
export const getForecastForPolicy = async (
  providers: Readonly<Record<string, ForecastProvider>>,
  policy: WeatherSourcePolicy,
  request: ForecastRequest,
  signal: AbortSignal,
): Promise<SelectedForecast> => {
  const allowed =
    policy.mode === 'strict'
      ? [policy.providerId]
      : [...new Set(policy.providerIds)];
  const attempts: Attempt[] = [];
  let first: SelectedForecast | undefined;
  let firstUsable: SelectedForecast | undefined;
  for (const providerId of allowed) {
    const provider = Object.hasOwn(providers, providerId)
      ? providers[providerId]
      : undefined;
    const source = provider?.source ?? {
      providerId,
      productId: 'unconfigured',
      adapterVersion: 'none',
    };
    const failed = (
      code: 'cancelled' | 'not-configured' | 'upstream-unavailable',
      message: string,
    ): readonly LocationForecastResult[] =>
      request.locations.map((requested) => ({
        status: 'unavailable',
        requested,
        source,
        issues: [{ code, message }],
      }));
    let results: readonly LocationForecastResult[];
    if (signal.aborted)
      results = failed('cancelled', 'Forecast request was cancelled.');
    else if (!provider || provider.source.providerId !== providerId)
      results = failed(
        'not-configured',
        'The selected weather provider is not configured.',
      );
    else {
      try {
        results = await provider.getForecast(request, signal);
      } catch {
        results = failed(
          signal.aborted ? 'cancelled' : 'upstream-unavailable',
          'The selected weather provider could not supply a forecast.',
        );
      }
    }
    const resultIds = results.map((result) =>
      result.status === 'unavailable'
        ? result.requested.id
        : result.location.requested.id,
    );
    if (
      results.length !== request.locations.length ||
      new Set(resultIds).size !== resultIds.length ||
      request.locations.some((location) => !resultIds.includes(location.id)) ||
      results.some((result) => {
        const actual =
          result.status === 'unavailable'
            ? result.source
            : result.provenance.source;
        return (
          actual.providerId !== source.providerId ||
          actual.productId !== source.productId ||
          actual.adapterVersion !== source.adapterVersion
        );
      })
    ) {
      results = failed(
        'upstream-unavailable',
        'The selected weather provider returned inconsistent location or source metadata.',
      );
    }
    const status =
      results.length > 0 &&
      results.every((result) => result.status === 'complete')
        ? 'complete'
        : results.some((result) => result.status !== 'unavailable')
          ? 'partial'
          : 'unavailable';
    attempts.push({ source, status });
    const selected = { source, results, attempts };
    first ??= selected;
    if (status !== 'unavailable') firstUsable ??= selected;
    if (status === 'complete' || signal.aborted) return selected;
  }
  const selected = firstUsable ?? first;
  if (!selected)
    throw new Error('At least one weather provider must be selected.');
  return { ...selected, attempts };
};

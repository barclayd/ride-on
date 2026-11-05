/** Explicit authenticated check; never run by CI. No raw forecasts or secrets in output. */
import { createCwa, cwaPrecipitationProbability } from '../src/weather/cwa.ts';
import { weatherDescriptors as weather } from '../src/weather/descriptors.ts';

const main = async () => {
  const apiKey = Bun.env.CWA_API_KEY;
  if (!apiKey) throw new Error('Missing credentials');
  const step = 3 * 3_600_000;
  // Taipei's three-hour grid is UTC 01, 04, 07, ... (+08:00 locally).
  const start = Math.ceil((Date.now() - 3_600_000) / step) * step + 3_600_000;
  let calls = 0;
  const provider = createCwa({
    apiKey,
    fetch: async (url, init) => {
      calls++;
      return fetch(url, init);
    },
  });
  const result = (
    await provider.getForecast(
      {
        locations: [
          {
            id: 'taipei-songshan',
            coordinate: { latitude: 25.051608, longitude: 121.568983 },
          },
        ],
        range: {
          start: new Date(start).toISOString(),
          end: new Date(start + 2 * step).toISOString(),
        },
        required: [
          weather.airTemperature,
          weather.feelsLikeTemperature,
          weather.windSpeed,
          weather.windDirection,
          cwaPrecipitationProbability,
        ],
        maxTimeStepSeconds: step / 1000,
        maxLocationDistanceM: 10_000,
        maxAgeSeconds: 3600,
        freshnessBasis: 'retrieval-time',
      },
      new AbortController().signal,
    )
  )[0];
  if (!result) throw new Error('Missing result');
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        source: provider.source,
        purpose:
          'Authenticated CWA transport and native-resolution contract check; not hourly recommendation or route coverage validation.',
        upstreamCalls: calls,
        status: result.status,
        issues: result.issues,
        ...(result.status === 'unavailable'
          ? {}
          : {
              sourceLocationId: result.location.sourceLocationId,
              distanceM: result.location.distanceFromRequestedM,
              attribution: result.provenance.attribution,
              series: result.series.map((s) => ({
                descriptor: s.descriptor,
                samples: s.samples.length,
                missing: s.samples.filter((v) => v.value === null).length,
              })),
            }),
      },
      null,
      2,
    ),
  );
  if (result.status !== 'complete') process.exitCode = 1;
};
try {
  await main();
} catch {
  console.error(
    'CWA probe failed. Check the local CWA_API_KEY and network connection.',
  );
  process.exitCode = 1;
}

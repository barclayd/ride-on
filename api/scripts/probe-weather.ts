/** Explicit live check, separate from CI/tests. Outputs diagnostics, not raw forecasts. */
import { readFile } from 'node:fs/promises';
import { createMetOfficeGlobalSpot } from '../src/weather/met-office-global-spot.ts';
import { getForecastForPolicy } from '../src/weather/source-policy.ts';
import { forecastRequestSchema } from '../src/weather/validation.ts';

const main = async () => {
  const [inputPath, outputPath] = Bun.argv.slice(2);
  if (!inputPath || !outputPath || !Bun.env.MET_OFFICE_API_KEY) {
    throw new Error('Input, output and credentials are required.');
  }
  const request = forecastRequestSchema.parse(
    JSON.parse(await readFile(inputPath, 'utf8')),
  );
  let upstreamCalls = 0;
  const provider = createMetOfficeGlobalSpot({
    apiKey: Bun.env.MET_OFFICE_API_KEY,
    fetch: async (url, init) => {
      upstreamCalls++;
      return fetch(url, init);
    },
  });
  const started = performance.now();
  const selected = await getForecastForPolicy(
    { 'met-office': provider },
    { mode: 'strict', providerId: 'met-office' },
    request,
    new AbortController().signal,
  );
  const report = {
    checkedAt: new Date().toISOString(),
    purpose:
      'Live adapter integration check at supplied route samples; not route ranking or complete spatial coverage.',
    source: selected.source,
    assessmentRange: request.range,
    diagnosticLimits: {
      maxLocationDistanceM: request.maxLocationDistanceM,
      maxAgeSeconds: request.maxAgeSeconds,
      maxTimeStepSeconds: request.maxTimeStepSeconds,
    },
    upstreamCalls,
    elapsedMs: Math.round(performance.now() - started),
    latencyNote:
      'One local live run; not a Cloudflare latency benchmark or percentile measurement.',
    attribution: 'Powered by Met Office data',
    results: selected.results.map((result) => {
      if (result.status === 'unavailable')
        return {
          id: result.requested.id,
          status: result.status,
          issues: result.issues,
        };
      const times = result.series
        .flatMap((series) => series.samples.map((sample) => sample.validAt))
        .sort();
      return {
        id: result.location.requested.id,
        status: result.status,
        modelRun: result.provenance.dataVersion,
        distanceToForecastLocationM: Math.round(
          result.location.distanceFromRequestedM,
        ),
        seriesCount: result.series.length,
        missingValues: result.series.reduce(
          (count, series) =>
            count +
            series.samples.filter((sample) => sample.value === null).length,
          0,
        ),
        firstValidityTime: times[0],
        lastValidityTime: times.at(-1),
        issues: result.issues,
      };
    }),
  };
  await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (selected.results.some((result) => result.status !== 'complete'))
    process.exitCode = 1;
};

try {
  await main();
} catch {
  console.error(
    'Weather probe failed. Check the input, output path and local credential configuration.',
  );
  process.exitCode = 1;
}

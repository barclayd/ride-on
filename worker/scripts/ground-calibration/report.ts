import { DAY, dateKey, HOUR, hourFloor } from '../../src/ground/contracts.ts';
import { cellFor } from '../../src/ground/spatial.ts';
import { summarizeHours } from '../../src/ground/summary.ts';
import {
  estimateGround,
  type GroundEvidence,
  hindcastWetnessTimeline,
  WETNESS_MODEL,
} from '../../src/ground/wetness.ts';
import { readArchive } from './archive.ts';
import { type CalibrationTrack, sampleTrack } from './track.ts';

export const calibrateTrack = async (
  track: CalibrationTrack,
  options: {
    fromM: number;
    toM: number;
    samples: number;
    directory: string;
    live: boolean;
    now: Date;
    archive?: typeof readArchive;
  },
) => {
  const samples = sampleTrack(
    track,
    options.fromM,
    options.toM,
    options.samples,
  );
  const first = dateKey(
    hourFloor(track.start) - WETNESS_MODEL.backgroundHours * HOUR,
  );
  const last = dateKey(track.end);
  const unique = new Map(
    samples.map((sample) => {
      const cell = cellFor(sample);
      return [cell.id, cell] as const;
    }),
  );
  const evidence = new Map<string, Awaited<ReturnType<typeof readArchive>>>();
  // Bounded and sequential: at most 12 unique cells, one request per cache miss.
  for (const cell of unique.values())
    evidence.set(
      cell.id,
      await (options.archive ?? readArchive)(cell, first, last, options),
    );
  const results = samples.map((sample) => {
    const cell = cellFor(sample);
    const archive = evidence.get(cell.id);
    if (!archive) throw new Error('Missing archive cell.');
    const cutoff = hourFloor(sample.time);
    const days = [
      ...new Set(archive.hours.map((hour) => hour.end.slice(0, 10))),
    ].map((date) => ({
      date,
      retrievedAt: archive.retrievedAt,
      refreshAt: null,
      gridCoordinate: archive.gridCoordinate,
      stale: false,
    }));
    const input: GroundEvidence['cells'][number] = {
      ...cell,
      refreshStatus: 'cached',
      days,
      history: [],
      hours: archive.hours,
    };
    const replay = hindcastWetnessTimeline(
      input,
      track.start,
      cutoff,
      options.now.getTime(),
    );
    const snapshot = replay.timeline.get(cutoff);
    return {
      ...sample,
      passageAt: new Date(sample.time).toISOString(),
      evidenceThrough: new Date(cutoff).toISOString(),
      cell,
      gridCoordinate: archive.gridCoordinate,
      retrievedAt: archive.retrievedAt,
      surface: 'unresolved' as const,
      history: [24, 72, 168, 336, 672].map((hours) => ({
        hours,
        ...summarizeHours(archive.hours, cutoff, hours),
      })),
      estimate: estimateGround(snapshot, 'unresolved'),
      sensitivity: {
        ifGranular: estimateGround(snapshot, 'granular'),
        ifSoftMaterial: estimateGround(snapshot, 'soft'),
      },
    };
  });
  return {
    schemaVersion: 1,
    purpose: 'hindcast',
    historicalForecastValidation: false,
    scoringApplied: false,
    reconstructedAt: options.now.toISOString(),
    model: WETNESS_MODEL,
    source: {
      provider: 'Open-Meteo',
      product: 'Historical Forecast API',
      model: 'ukmo_seamless',
      basis: 'stitched-model-runs',
      observed: false,
      modelRunAt: null,
      documentation: 'https://open-meteo.com/en/docs/historical-forecast-api',
      attribution:
        'Weather data by Open-Meteo using UK Met Office models (CC BY 4.0); analysed by Ride On.',
    },
    track: {
      title: track.title,
      distanceM: track.distanceM,
      start: new Date(track.start).toISOString(),
      end: new Date(track.end).toISOString(),
      pointCount: track.points.length,
    },
    sampling: {
      fromM: options.fromM,
      toM: options.toM,
      sampleCount: results.length,
      requestCells: unique.size,
      cellSizeDegrees: 0.05,
      representsRouteCoverage: false,
    },
    usage: {
      httpRequests: [...evidence.values()].reduce(
        (sum, value) => sum + value.httpRequests,
        0,
      ),
      estimatedWeightedCalls: [...evidence.values()].reduce(
        (sum, value) =>
          sum +
          value.httpRequests *
            Math.max(
              1,
              (Date.parse(last) - Date.parse(first) + DAY) / DAY / 14,
            ),
        0,
      ),
    },
    archives: [...evidence.values()].map(({ path, url, retrievedAt }) => ({
      path,
      url,
      retrievedAt,
    })),
    results,
  };
};
export type CalibrationReport = Awaited<ReturnType<typeof calibrateTrack>>;

export const reportMarkdown = (report: CalibrationReport) => {
  const number = (value: number | null | undefined) =>
    value == null ? 'unknown' : value.toFixed(1);
  const rows = report.results.map((result) => {
    const rain = (hours: number) =>
      number(result.history.find((h) => h.hours === hours)?.rain.totalMm);
    const condition = (estimate: typeof result.estimate) =>
      estimate.condition ?? estimate.status;
    return `| ${result.sample} | ${(result.distanceM / 1000).toFixed(1)} | ${result.passageAt.slice(11, 16)} | ${rain(24)} | ${rain(72)} | ${rain(168)} | ${rain(336)} | ${number(result.estimate.wetnessIndex?.central)} | ${condition(result.sensitivity.ifGranular)} | ${condition(result.sensitivity.ifSoftMaterial)} |`;
  });
  return `# Ground-condition hindcast\n\n${report.track.title.replace(/[\r\n#|]/g, ' ')} — ${report.track.start.slice(0, 10)}. Reconstructed ${report.reconstructedAt}.\n\nThis is a retrospective mechanism check, not a reconstruction of the forecast known before the ride. No score penalty is applied. Weather is modelled history, not rainfall observations or measured soil moisture.\n\n## Sample comparison\n\nSamples retain actual GPX passage times. Each uses only completed weather hours up to that time, plus 28 days of initialization before the ride. The 0.05° request lattice is not the native model grid. Samples do not establish route-wide coverage.\n\n| Sample | Recorded km | UTC | Rain 24h mm | 3d mm | 7d mm | 14d mm | Central wetness index | If gravel/compacted | If earth/grass |\n|---|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\nThe index (0–100, higher means wetter) is an experimental model output, not a comfort score or probability. Material is unresolved: both columns are sensitivity scenarios, not claims about the path. Drainage is unmeasured and every estimate remains low confidence. See the JSON for scenario ranges, missing-data reasons, grid coordinates and retrieval provenance.\n\n## Reproducibility\n\nModel: ${report.model.version}. ${report.usage.httpRequests} HTTP requests this run; ${report.sampling.requestCells} distinct cached cells. Rerun without --live to use exactly the stored snapshots.\n\n${report.source.attribution}\n\n[Historical Forecast API documentation](${report.source.documentation}). Local GPX, archive responses and report are private calibration evidence; do not commit them as public test fixtures.\n`;
};

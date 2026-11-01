import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { calibrateTrack, reportMarkdown } from './ground-calibration/report.ts';
import {
  MAX_GPX_BYTES,
  parseCalibrationTrack,
} from './ground-calibration/track.ts';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  strict: true,
  options: {
    gpx: { type: 'string' },
    out: { type: 'string' },
    'from-km': { type: 'string', default: '0' },
    'to-km': { type: 'string' },
    samples: { type: 'string', default: '8' },
    live: { type: 'boolean', default: false },
  },
});
if (!values.gpx || !values.out)
  throw new Error(
    'Usage: bun scripts/calibrate-ground.ts --gpx <recorded.gpx> --out <private directory> [--from-km 0 --to-km 100 --samples 8] [--live]',
  );
const file = Bun.file(values.gpx);
if (file.size > MAX_GPX_BYTES)
  throw new Error('Calibration GPX is limited to 20 MB.');
const xml = await file.text();
const track = parseCalibrationTrack(xml);
const directory = resolve(values.out);
const report = await calibrateTrack(track, {
  fromM: Number(values['from-km']) * 1000,
  toM:
    values['to-km'] === undefined
      ? track.distanceM
      : Number(values['to-km']) * 1000,
  samples: Number(values.samples),
  directory: join(directory, 'archive'),
  live: values.live,
  now: new Date(),
});
const output = {
  ...report,
  track: {
    ...report.track,
    sha256: createHash('sha256').update(xml).digest('hex'),
  },
};
await mkdir(directory, { recursive: true });
await Bun.write(
  join(directory, 'hindcast.json'),
  JSON.stringify(output, null, 2),
);
await Bun.write(join(directory, 'hindcast.md'), reportMarkdown(output));
console.log(
  JSON.stringify({
    report: join(directory, 'hindcast.md'),
    samples: report.sampling.sampleCount,
    cells: report.sampling.requestCells,
    httpRequests: report.usage.httpRequests,
  }),
);

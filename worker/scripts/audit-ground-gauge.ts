import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  auditGauge,
  gaugeAuditMarkdown,
} from './ground-calibration/hydrology.ts';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  strict: true,
  options: Object.fromEntries(
    ['measure', 'readings', 'latitude', 'longitude', 'through', 'out'].map(
      (key) => [key, { type: 'string' as const }],
    ),
  ),
});
const { measure, readings, latitude, longitude, through, out } = values;
if (!measure || !readings || !latitude || !longitude || !through || !out)
  throw new Error(
    'Usage: bun scripts/audit-ground-gauge.ts --measure <metadata.json> --readings <snapshot.json> --latitude <lat> --longitude <lon> --through <UTC time> --out <private directory>',
  );
const read = async (path: string) => {
  const file = Bun.file(path);
  if (file.size > 2_100_000)
    throw new Error('Gauge input is limited to 2.1 MB.');
  const text = await file.text();
  return {
    data: JSON.parse(text) as unknown,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
};
const [metadata, snapshot] = await Promise.all([read(measure), read(readings)]);
const report = auditGauge(metadata.data, snapshot.data, {
  latitude: Number(latitude),
  longitude: Number(longitude),
  through,
});
const directory = resolve(out);
await mkdir(directory, { recursive: true });
await Bun.write(
  join(directory, 'gauge-audit.json'),
  JSON.stringify(
    {
      ...report,
      inputHashes: { metadata: metadata.sha256, readings: snapshot.sha256 },
    },
    null,
    2,
  ),
);
await Bun.write(join(directory, 'gauge-audit.md'), gaugeAuditMarkdown(report));
console.log(
  JSON.stringify({
    report: join(directory, 'gauge-audit.md'),
    httpRequests: 0,
  }),
);

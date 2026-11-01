/** Explicit maintenance command; never run by tests, requests or deployment.
 * bun scripts/import-seasonal-climate.ts
 * Adding minimums is display-only. A change to existing maximums/geometry must
 * be reviewed as a separate scoring/data version change. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import existing from '../src/climate/haduk-grid.json';
import { readBoundedJson } from '../src/weather/http.ts';

const sources = {
  maximum:
    'https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/Monthly_Max_Temperature_Observations_1991_2020/FeatureServer/8',
  minimum:
    'https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/Monthly_Min_Temperature_Observations_1991_2020/FeatureServer/6',
};
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const responseSchema = z.object({
  exceededTransferLimit: z.boolean().optional(),
  features: z.array(
    z.object({
      attributes: z.object({ GRID_ID: z.string() }).catchall(z.unknown()),
      geometry: z.object({
        rings: z
          .array(z.array(z.tuple([z.number(), z.number()])).min(4))
          .length(1),
      }),
    }),
  ),
});
const download = async (statistic: keyof typeof sources, prefix: string) => {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: ['GRID_ID', ...months.map((m) => `${prefix}${m}`)].join(','),
    outSR: '4326',
    returnGeometry: 'true',
    orderByFields: 'GRID_ID',
    resultRecordCount: '2000',
  });
  const response = await fetch(`${sources[statistic]}/query?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Climate download failed (${response.status}).`);
  const raw = await readBoundedJson(response, 4_000_000);
  const parsed = responseSchema.parse(raw);
  if (parsed.exceededTransferLimit || parsed.features.length !== 1707)
    throw new Error(
      'Unexpected climate coverage: review the source before updating.',
    );
  const cells = parsed.features.map(({ attributes, geometry }) => ({
    id: attributes.GRID_ID,
    ring:
      geometry.rings[0]?.map((pair) => pair.map((v) => Number(v.toFixed(6)))) ??
      [],
    values: months.map((m) =>
      Number(
        z
          .number()
          .min(-30)
          .max(50)
          .parse(attributes[`${prefix}${m}`])
          .toFixed(3),
      ),
    ),
  }));
  if (new Set(cells.map((c) => c.id)).size !== cells.length)
    throw new Error('Duplicate climate cells.');
  return {
    cells,
    sha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
  };
};
const [maximum, minimum] = await Promise.all([
  download('maximum', 'tmax'),
  download('minimum', 'tmin'),
]);
const minimumById = new Map(minimum.cells.map((cell) => [cell.id, cell]));
const previousById = new Map(existing.cells.map((cell) => [cell.id, cell]));
const cells = maximum.cells.map((cell) => {
  const low = minimumById.get(cell.id);
  const previous = previousById.get(cell.id);
  if (!low || JSON.stringify(cell.ring) !== JSON.stringify(low.ring))
    throw new Error(`Mismatched minimum grid cell ${cell.id}.`);
  if (
    !previous ||
    JSON.stringify(cell.ring) !== JSON.stringify(previous.ring) ||
    JSON.stringify(cell.values) !== JSON.stringify(previous.maximumC)
  )
    throw new Error(
      'Scoring climate data changed: review and version separately.',
    );
  if (low.values.some((v, i) => v > (cell.values[i] ?? -Infinity)))
    throw new Error('Minimum exceeds maximum.');
  return {
    id: cell.id,
    ring: cell.ring,
    maximumC: cell.values,
    minimumC: low.values,
  };
});
const data = {
  ...existing,
  // Keep the maximum-only version stable for scoring baselines.
  displayVersion: 'haduk-grid-1.1.0.0-1991-2020-12km-tmax-tmin',
  statistics: ['maximum', 'minimum'],
  sources,
  responseSha256: { maximum: maximum.sha256, minimum: minimum.sha256 },
  cells,
};
await Bun.write(
  new URL('../src/climate/haduk-grid.json', import.meta.url),
  JSON.stringify(data),
);
console.log(
  `Imported ${cells.length} paired climate cells (${data.displayVersion}); scoring data unchanged.`,
);

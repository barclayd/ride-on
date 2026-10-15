/** Explicit maintenance command; never run by tests, requests or deployment.
 * bun scripts/import-seasonal-climate.ts
 * Review the generated data and bump the scoring version before publishing. */
import { createHash } from 'node:crypto';
import { z } from 'zod';

const source =
  'https://services.arcgis.com/Lq3V5RFuTBC9I7kv/arcgis/rest/services/Monthly_Max_Temperature_Observations_1991_2020/FeatureServer/8';
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
const params = new URLSearchParams({
  f: 'json',
  where: '1=1',
  outFields: ['GRID_ID', ...months.map((m) => `tmax${m}`)].join(','),
  outSR: '4326',
  returnGeometry: 'true',
  orderByFields: 'GRID_ID',
  resultRecordCount: '2000',
});
const response = await fetch(`${source}/query?${params}`, {
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok)
  throw new Error(`Climate download failed (${response.status}).`);
const raw = await response.text();
const parsed = responseSchema.parse(JSON.parse(raw));
if (parsed.exceededTransferLimit || parsed.features.length !== 1707)
  throw new Error(
    'Unexpected climate coverage: review the source before updating.',
  );
const cells = parsed.features.map(({ attributes, geometry }) => ({
  id: attributes.GRID_ID,
  ring:
    geometry.rings[0]?.map((pair) => pair.map((v) => Number(v.toFixed(6)))) ??
    [],
  maximumC: months.map((m) =>
    Number(
      z.number().min(-30).max(50).parse(attributes[`tmax${m}`]).toFixed(3),
    ),
  ),
}));
if (new Set(cells.map((c) => c.id)).size !== cells.length)
  throw new Error('Duplicate climate cells.');
const data = {
  version: 'haduk-grid-1.1.0.0-1991-2020-12km-tmax',
  referencePeriod: '1991–2020',
  statistic: 'monthly-mean-daily-maximum-temperature',
  attribution:
    'Contains Met Office data licensed under the Open Government Licence v3.0.',
  licence:
    'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  source,
  catalogue:
    'https://catalogue.ceda.ac.uk/uuid/652cea3b8b4446f7bff73be0ce99ba0f',
  rawSha256: createHash('sha256').update(raw).digest('hex'),
  cells,
};
await Bun.write(
  new URL('../src/climate/haduk-grid.json', import.meta.url),
  JSON.stringify(data),
);
console.log(`Imported ${cells.length} climate cells (${data.version}).`);

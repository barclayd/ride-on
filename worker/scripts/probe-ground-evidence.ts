/** Explicit non-commercial live diagnostic. Never imported by tests or the Worker. */
import { z } from 'zod';
import { coordinate, DAY, dateKey, dayStart } from '../src/ground/contracts.ts';
import { fetchGaugeComparison } from '../src/ground/gauges.ts';
import { openMeteoGroundProvider } from '../src/ground/open-meteo.ts';
import { summarizeHours } from '../src/ground/summary.ts';

if (process.argv[2] !== '--live' || process.argv.length !== 5) {
  console.error(
    'Usage: bun scripts/probe-ground-evidence.ts --live LATITUDE LONGITUDE (up to 8 public HTTP requests; non-commercial use only)',
  );
  process.exit(1);
}
const point = coordinate.parse({
  latitude: z.coerce.number().parse(process.argv[3]),
  longitude: z.coerce.number().parse(process.argv[4]),
});
const now = new Date();
const today = dayStart(dateKey(now.getTime()));
const first = dateKey(today - 14 * DAY);
const last = dateKey(today - DAY);
const gauge = await fetchGaugeComparison(point, first, last, now);
if (gauge.status !== 'available') {
  console.log(JSON.stringify(gauge, null, 2));
  process.exit(0);
}
// Compare at the gauge coordinate to avoid adding unnecessary spatial mismatch.
const model = await openMeteoGroundProvider.fetch(
  gauge.gauge.coordinate,
  first,
  dateKey(today),
  now,
);
console.log(
  JSON.stringify(
    {
      experimental: true,
      scoringApplied: false,
      sources: [openMeteoGroundProvider.attribution, gauge.attribution],
      model: openMeteoGroundProvider.model,
      gridCoordinate: model.gridCoordinate,
      usage: {
        httpRequests: gauge.httpRequests + 1,
        openMeteoEstimatedWeightedCalls: 15 / 14,
        actualBillableCalls: null,
      },
      gauge,
      comparison: gauge.days.map((day) => ({
        date: day.date,
        modelled: summarizeHours(model.hours, dayStart(day.date) + DAY, 24),
        observed: day,
      })),
      limitations: [
        'Gauge timestamps are shown under both interval-edge interpretations pending confirmation; comparisons are provisional.',
        'Gauge readings can arrive once or twice daily; incomplete periods are not zero rainfall.',
        'Point observations and model-grid estimates differ spatially. This is rainfall validation, not proof of path rideability.',
      ],
    },
    null,
    2,
  ),
);

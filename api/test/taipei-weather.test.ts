import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { importGpx } from '../src/routes/gpx.ts';
import { nearestCwaLocation } from '../src/weather/cwa.ts';
import { taipeiGpx, taipeiRoutes } from './fixtures/taipei.ts';

test('both Taipei route samples resolve to nearby CWA townships', async () => {
  const sites = new Set<string>();
  const townships: string[][] = [];
  for (const fixture of taipeiRoutes) {
    const route = await importGpx(taipeiGpx(fixture));
    const names: string[] = [];
    assert.ok(route.distanceM > 7500 && route.distanceM < 11_000);
    for (const location of route.weatherLocations) {
      const nearest = nearestCwaLocation(location);
      assert.ok(nearest);
      assert.ok(nearest.distanceM < 5000);
      assert.ok(['F-D0047-061'].includes(nearest.site.datasetId));
      sites.add(nearest.site.datasetId);
      names.push(nearest.site.name);
    }
    townships.push(names);
  }
  assert.deepEqual([...sites].sort(), ['F-D0047-061']);
  assert.deepEqual(townships, [
    ['大同區', '北投區'],
    ['中山區', '南港區'],
  ]);
});

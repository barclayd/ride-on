import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { allAlertTriggers, readAlerts } from '../src/tracking/alerts.ts';
import { publicTracking, type TrackingRow } from '../src/tracking/store.ts';
import { trackingSnapshot } from './fixtures/tracking.ts';

test('migration gives existing rides all triggers without changing baseline or lifecycle', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(
      readFileSync(
        new URL('../migrations/0010_tracked_rides.sql', import.meta.url),
        'utf8',
      ),
    );
    const baseline = JSON.stringify(await trackingSnapshot());
    db.prepare(`INSERT INTO tracked_rides(owner_id,id,route_id,departure_at,finish_at,time_zone,created_at,state,baseline_json)
      VALUES ('alice','plan','route','2026-10-10T10:00:00.000Z','2026-10-10T12:00:00.000Z','Europe/London','2026-10-09T12:00:00.000Z','active',?)`).run(
      baseline,
    );
    db.exec(
      readFileSync(
        new URL('../migrations/0019_tracking_alerts.sql', import.meta.url),
        'utf8',
      ),
    );
    const row = db
      .query<TrackingRow, []>(
        'SELECT *, NULL AS latest_json FROM tracked_rides',
      )
      .get();
    expect(row).not.toBeNull();
    if (!row) throw new Error('Missing migrated plan');
    const ride = publicTracking(row, '2026-10-09T12:00:00.000Z');
    expect(ride.alerts.triggers).toEqual(allAlertTriggers);
    expect(row.baseline_json).toBe(baseline);
    expect(ride.state).toBe('active');
    expect(ride.version).toBe(1);
    expect(readAlerts(undefined).triggers).toEqual(allAlertTriggers);
  } finally {
    db.close();
  }
});

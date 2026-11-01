import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';

test('browser push migration preserves native registrations and their existing Strava delivery outbox', () => {
  const db = new Database(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of readdirSync(directory)
      .filter((f) => f.endsWith('.sql') && f < '0018')
      .sort())
      db.exec(readFileSync(new URL(file, directory), 'utf8'));
    db.exec(`INSERT INTO auth_user VALUES('u','User','user@example.test',1,NULL,1,1);
      INSERT INTO auth_user_owners VALUES('u','owner');
      INSERT INTO strava_connections VALUES('owner','athlete','grant','[]',1,'gen');
      INSERT INTO strava_import_sessions(owner_id,generation,initialized_at,last_scan_at,requested_after,requested_before) VALUES('owner','gen',1,1,1,2);
      INSERT INTO strava_activity_cache(owner_id,generation,activity_id,started_at,match_json,decision,first_seen_at,fetched_at,expires_at) VALUES('owner','gen','activity','2026-10-09','{}','automatic',1,1,9);
      INSERT INTO push_devices VALUES('device','owner','token','sandbox','com.danbarclay.rideon','ios',7,'2026-10-09');
      INSERT INTO strava_push_deliveries VALUES('delivery','owner','activity','device',7,'accepted',9);`);
    const before = db.query('SELECT * FROM strava_push_deliveries').all();
    db.exec(readFileSync(new URL('0018_browser_push.sql', directory), 'utf8'));
    expect(db.query('SELECT * FROM strava_push_deliveries').all()).toEqual(
      before,
    );
    expect(
      db
        .query('SELECT transport,version,subscription_json FROM push_devices')
        .get(),
    ).toEqual({ transport: 'apns', version: 7, subscription_json: null });
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec("DELETE FROM push_devices WHERE id='device'");
    expect(db.query('SELECT * FROM strava_push_deliveries').all()).toEqual([]);
  } finally {
    db.close();
  }
});

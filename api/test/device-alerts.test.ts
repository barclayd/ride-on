import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  allowsDeviceAlert,
  deviceAlerts,
  devicePayload,
} from '../src/monitoring/device-alerts.ts';

test('migration preserves registrations and enables all switches for existing devices', () => {
  const db = new Database(':memory:');
  const migrations = new URL('../migrations/', import.meta.url);
  try {
    for (const file of readdirSync(migrations)
      .sort()
      .filter((name) => name.endsWith('.sql') && name < '0020'))
      db.exec(readFileSync(new URL(file, migrations), 'utf8'));
    db.exec(`INSERT INTO push_devices(id,owner_id,token,environment,topic,platform,registered_at,version)
      VALUES ('mac','alice','abc','sandbox','com.danbarclay.rideon','macos','2026-10-09T12:00:00.000Z',7)`);
    const before = db
      .query<Record<string, unknown>, []>('SELECT * FROM push_devices')
      .get();
    db.exec(
      readFileSync(new URL('0020_device_alerts.sql', migrations), 'utf8'),
    );
    expect(db.prepare('SELECT * FROM push_devices').get()).toEqual({
      ...before,
      ride_alerts: 1,
      final_forecast: 1,
      sound: 1,
    });
    expect(deviceAlerts({})).toEqual({
      rideAlerts: true,
      finalForecast: true,
      sound: true,
    });
  } finally {
    db.close();
  }
});

test('each ride reason, including outages, follows Ride alerts; combined messages allow either switch', () => {
  const rideOnly = { ride_alerts: 1, final_forecast: 0 };
  const summaryOnly = { ride_alerts: 0, final_forecast: 1 };
  for (const reason of [
    'score_improved',
    'score_worsened',
    'minimum_breach',
    'minimum_recovery',
    'rain_likely',
    'feels_cold',
    'better_option',
    'unavailable',
    'available_again',
  ]) {
    expect(allowsDeviceAlert(rideOnly, [reason])).toBe(true);
    expect(allowsDeviceAlert(summaryOnly, [reason])).toBe(false);
    expect(allowsDeviceAlert(rideOnly, ['evening_summary', reason])).toBe(true);
    expect(allowsDeviceAlert(summaryOnly, ['evening_summary', reason])).toBe(
      true,
    );
    expect(
      allowsDeviceAlert({ ride_alerts: 0, final_forecast: 0 }, [
        'evening_summary',
        reason,
      ]),
    ).toBe(false);
  }
  expect(allowsDeviceAlert(rideOnly, ['evening_summary'])).toBe(false);
  expect(allowsDeviceAlert(summaryOnly, ['evening_summary'])).toBe(true);
});

test('silencing APNs preserves message content and grouping, while Web Push stays unchanged', () => {
  const message = {
    aps: {
      alert: { title: 'Forecast', body: 'Ride update' },
      sound: 'default',
      'thread-id': 'plan',
    },
    reasons: ['score_worsened'],
    notificationId: 'id',
  };
  const payload = JSON.stringify(message);
  const quiet = devicePayload({ sound: 0 }, payload);
  expect(JSON.parse(quiet)).toEqual({
    ...message,
    aps: { alert: message.aps.alert, 'thread-id': 'plan' },
  });
  expect(devicePayload({}, payload)).toBe(payload);
  const browser = {
    transport: 'web_push',
    ride_alerts: 0,
    final_forecast: 0,
    sound: 0,
  };
  expect(devicePayload(browser, payload)).toBe(payload);
  expect(allowsDeviceAlert(browser, ['score_worsened'])).toBe(true);
});

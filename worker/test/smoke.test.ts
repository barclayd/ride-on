/**
 * Deployed smoke tests — run against a live URL, not local code.
 * Requires WORKER_URL in the environment; skipped entirely otherwise.
 *
 * Run with: WORKER_URL=https://ride-on-api.<subdomain>.workers.dev bun test test/smoke.test.ts
 */
import { expect, test } from 'bun:test';

const WORKER_URL = process.env.WORKER_URL;
const skipWithoutUrl = WORKER_URL ? test : test.skip;

skipWithoutUrl('GET /health responds ok', async () => {
  const res = await fetch(`${WORKER_URL}/health`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; version: string };
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe('string');
});

skipWithoutUrl('POST /classify handles a tiny real route', async () => {
  const res = await fetch(`${WORKER_URL}/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [
        [51.7189, -1.9694],
        [51.7205, -1.965],
        [51.723, -1.96],
      ],
    }),
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    surfaces: Record<string, number>;
    suggestedType: string;
    source: string;
  };
  expect(['road', 'gravel', 'mixed']).toContain(body.suggestedType);
  expect(body.source).toBe('valhalla');
  const sum = Object.values(body.surfaces).reduce((a, b) => a + b, 0);
  expect(sum).toBeCloseTo(1, 1);
});

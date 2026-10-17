import { expect, test } from 'bun:test';
import { ALGORITHM_VERSION } from '../src/recommendations/engine.ts';

const url = process.env.WORKER_URL;
const liveTest = url ? test : test.skip;
liveTest('deployed API identifies the recommendation build', async () => {
  const response = await fetch(`${url}/health`);
  expect(response.status).toBe(200);
  const health = (await response.json()) as {
    ok: boolean;
    version: string;
    algorithmVersion: string;
    revision: string | null;
  };
  expect(health).toMatchObject({
    ok: true,
    version: '0.32.0',
    algorithmVersion: ALGORITHM_VERSION,
  });
  if (process.env.EXPECTED_REVISION)
    expect(health.revision).toBe(process.env.EXPECTED_REVISION);
});
liveTest('deployed private route list requires authentication', async () => {
  expect((await fetch(`${url}/routes`)).status).toBe(401);
});
liveTest('deployed tracked ride list requires authentication', async () => {
  expect((await fetch(`${url}/tracked-rides`)).status).toBe(401);
});
liveTest('deployed push device list requires authentication', async () => {
  expect((await fetch(`${url}/push-devices`)).status).toBe(401);
});

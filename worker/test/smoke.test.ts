import { expect, test } from 'bun:test';

const url = process.env.WORKER_URL;
const liveTest = url ? test : test.skip;
liveTest('deployed API identifies the recommendation build', async () => {
  const response = await fetch(`${url}/health`);
  expect(response.status).toBe(200);
  expect((await response.json()) as { ok: boolean; version: string }).toEqual({
    ok: true,
    version: '0.4.0',
  });
});
liveTest('deployed private route list requires authentication', async () => {
  expect((await fetch(`${url}/routes`)).status).toBe(401);
});

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
    version: '0.47.0',
    algorithmVersion: ALGORITHM_VERSION,
  });
  if (process.env.EXPECTED_REVISION)
    expect(health.revision).toBe(process.env.EXPECTED_REVISION);
});
liveTest(
  'deployed MCP requires delegated OAuth and advertises its resource',
  async () => {
    const response = await fetch(`${url}/mcp`);
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      '/.well-known/oauth-protected-resource/mcp',
    );
    const metadata = await fetch(
      `${url}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: `${url}/mcp`,
      authorization_servers: [`${url}/api/auth`],
    });
  },
);
liveTest('deployed private route list requires authentication', async () => {
  expect((await fetch(`${url}/routes`)).status).toBe(401);
});
liveTest('deployed tracked ride list requires authentication', async () => {
  expect((await fetch(`${url}/tracked-rides`)).status).toBe(401);
});
liveTest('deployed push device list requires authentication', async () => {
  expect((await fetch(`${url}/push-devices`)).status).toBe(401);
});
liveTest('deployed pause writes require authentication', async () => {
  for (const method of ['PUT', 'DELETE'])
    expect((await fetch(`${url}/users/me/pause`, { method })).status).toBe(401);
});

liveTest(
  'deployed account key management and agent API require authentication',
  async () => {
    for (const path of [
      '/auth/api-keys',
      '/agent/v1/get_preferences',
      '/agent/v1/list_routes',
      '/agent/v1/add_route',
      '/agent/v1/score_routes',
      '/agent/v1/score_route_file',
    ]) {
      const response = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect((await fetch(`${url}/auth/api-keys`)).status).toBe(401);
  },
);

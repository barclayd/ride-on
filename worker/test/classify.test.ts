import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index.ts';
import { encodePolyline } from '../src/polyline.ts';
import type { Env } from '../src/types.ts';
import {
  cirencesterRoute,
  cirencesterValhallaResponse,
} from './fixtures/cirencester.ts';

// Minimal in-memory KV stub — only the get/put shapes classify.ts uses.
const createKvStub = (): Env['CLASSIFY_CACHE'] => {
  const store = new Map<string, string>();
  return {
    get: (async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    }) as Env['CLASSIFY_CACHE']['get'],
    put: (async (key: string, value: string) => {
      store.set(key, value);
    }) as Env['CLASSIFY_CACHE']['put'],
  } as Env['CLASSIFY_CACHE'];
};

let originalFetch: typeof fetch;
let env: Env;
let fetchCallCount: number;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchCallCount = 0;
  env = {
    CLASSIFY_CACHE: createKvStub(),
    STRAVA_CLIENT_ID: 'unused',
    STRAVA_CLIENT_SECRET: 'unused',
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockValhalla = (respond: () => Response) => {
  globalThis.fetch = (async () => {
    fetchCallCount++;
    return respond();
  }) as unknown as typeof fetch;
};

const postClassify = (body: unknown) =>
  app.request(
    '/classify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );

describe('POST /classify', () => {
  test('GET /health responds ok', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
  });

  test('cold call hits Valhalla, writes the cache, and second identical call is a cache hit with no extra upstream call', async () => {
    mockValhalla(
      () =>
        new Response(JSON.stringify(cirencesterValhallaResponse), {
          status: 200,
        }),
    );

    const requestBody = { polyline: encodePolyline(cirencesterRoute) };

    const first = await postClassify(requestBody);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      surfaces: Record<string, number>;
      suggestedType: string;
      cacheHit: boolean;
      source: string;
    };
    expect(firstBody.cacheHit).toBe(false);
    expect(firstBody.source).toBe('valhalla');
    const sum = Object.values(firstBody.surfaces).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(fetchCallCount).toBe(1);

    const second = await postClassify(requestBody);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { cacheHit: boolean };
    expect(secondBody.cacheHit).toBe(true);
    expect(fetchCallCount).toBe(1); // no additional upstream call
  });

  test('maps Valhalla 429 to a 503 with Retry-After', async () => {
    mockValhalla(
      () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '42' },
        }),
    );

    const res = await postClassify({
      coordinates: [
        [51.7, -1.9],
        [51.71, -1.91],
      ],
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('42');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  test('maps Valhalla 500 to a 503', async () => {
    mockValhalla(() => new Response('boom', { status: 500 }));
    const res = await postClassify({
      coordinates: [
        [51.7, -1.9],
        [51.71, -1.91],
      ],
    });
    expect(res.status).toBe(503);
  });

  test('rejects malformed JSON with 400', async () => {
    const res = await app.request(
      '/classify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test('rejects non-JSON content type with 415', async () => {
    const res = await app.request(
      '/classify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello',
      },
      env,
    );
    expect(res.status).toBe(415);
  });

  test('rejects a body missing both polyline and coordinates with 400', async () => {
    const res = await postClassify({ name: 'My Route' });
    expect(res.status).toBe(400);
  });

  test('rejects an undecodable polyline with 400', async () => {
    const res = await postClassify({ polyline: '~~~~~~~~~~~~~~~~~~~~' });
    expect(res.status).toBe(400);
  });

  test('rejects more than 50,000 points with 400', async () => {
    const coordinates = Array.from({ length: 50_001 }, (_, i) => [
      51 + i * 0.0000001,
      -1 + i * 0.0000001,
    ]);
    const res = await postClassify({ coordinates });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TOO_MANY_POINTS');
  });

  test('rejects a route longer than 400km with 400', async () => {
    // Two points ~4400km apart (London to somewhere well past the Sahara).
    const res = await postClassify({
      coordinates: [
        [51.5, -0.12],
        [20.0, -0.12],
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ROUTE_TOO_LONG');
  });
});

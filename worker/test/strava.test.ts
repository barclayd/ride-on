import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index.ts';
import type { Env } from '../src/types.ts';

const SECRET = 'super-secret-value-do-not-leak';

const testEnv: Env = {
  CLASSIFY_CACHE: {} as Env['CLASSIFY_CACHE'],
  STRAVA_CLIENT_ID: 'test-client-id',
  STRAVA_CLIENT_SECRET: SECRET,
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const postJson = (path: string, body: unknown) =>
  app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    testEnv,
  );

describe('POST /strava/token', () => {
  test("passes through Strava's success response verbatim", async () => {
    const stravaBody = {
      access_token: 'at_123',
      refresh_token: 'rt_456',
      expires_at: 1999999999,
      token_type: 'Bearer',
    };
    let calledWith: RequestInit | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calledWith = init;
      return new Response(JSON.stringify(stravaBody), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await postJson('/strava/token', { code: 'auth-code-abc' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof stravaBody;
    expect(body).toEqual(stravaBody);

    const sentBody = String(calledWith?.body);
    expect(sentBody).toContain('grant_type=authorization_code');
    expect(sentBody).toContain('code=auth-code-abc');
  });

  test('maps a Strava error to a sanitized 4xx and never echoes the secret', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ message: 'Bad Authorization Code', errors: [] }),
        { status: 400 },
      )) as unknown as typeof fetch;

    const res = await postJson('/strava/token', { code: 'bad-code' });
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };

    expect(res.status).toBe(400);
    expect(body.error).toEqual({
      code: 'STRAVA_ERROR',
      message: 'Bad Authorization Code',
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test('502/upstream failure never echoes the secret', async () => {
    globalThis.fetch = (async () => {
      throw new Error(`network down (secret was ${SECRET})`);
    }) as unknown as typeof fetch;

    const res = await postJson('/strava/token', { code: 'auth-code-abc' });
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(text).not.toContain(SECRET);
  });

  test('rejects a missing code with 400', async () => {
    const res = await postJson('/strava/token', {});
    expect(res.status).toBe(400);
  });

  test('rejects non-JSON content type with 415', async () => {
    const res = await app.request(
      '/strava/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'code=abc',
      },
      testEnv,
    );
    expect(res.status).toBe(415);
  });
});

describe('POST /strava/refresh', () => {
  test('rotates tokens and passes the new set through verbatim', async () => {
    const rotated = {
      access_token: 'at_new',
      refresh_token: 'rt_new',
      expires_at: 2000000000,
    };
    let calledWith: RequestInit | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calledWith = init;
      return new Response(JSON.stringify(rotated), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await postJson('/strava/refresh', { refresh_token: 'rt_old' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof rotated;
    expect(body).toEqual(rotated);
    expect(String(calledWith?.body)).toContain('grant_type=refresh_token');
  });

  test('rejects a missing refresh_token with 400', async () => {
    const res = await postJson('/strava/refresh', {});
    expect(res.status).toBe(400);
  });
});

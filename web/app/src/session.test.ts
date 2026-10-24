import { expect, test } from 'bun:test';
import { apiPath, callApi, challengeFor, safeNext } from './session.ts';

test('next stays on this origin', () => {
  expect(safeNext('/routes/abc?day=2026-10-27')).toBe(
    '/routes/abc?day=2026-10-27',
  );
  for (const bad of [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    '',
    null,
  ])
    expect(safeNext(bad)).toBe('/');
});

test('/api maps onto the API, keeping Better Auth paths', () => {
  expect(apiPath('/api/routes')).toBe('/routes');
  expect(apiPath('/api/auth/sign-out')).toBe('/api/auth/sign-out');
});

test('PKCE challenge is the base64url SHA-256 of the verifier (S256)', async () => {
  const verifier = 'a-verifier-long-enough-for-pkce-0123456789abcdef';
  expect(await challengeFor(verifier)).toBe(
    new Bun.CryptoHasher('sha256').update(verifier).digest('base64url'),
  );
});

test('a refreshed token becomes the session cookie and never reaches the browser', async () => {
  let sent: Request | undefined;
  const api = {
    fetch: async (request: Request) => {
      sent = request;
      return new Response('{}', { headers: { 'set-auth-token': 'fresh' } });
    },
  } as unknown as Fetcher;
  const from = new Request('https://app.ride-on.cc/', {
    headers: { 'cf-connecting-ip': '192.0.2.1' },
  });
  const response = await callApi(api, from, '/auth/me', 'old');
  expect(sent?.headers.get('Authorization')).toBe('Bearer old');
  expect(sent?.headers.get('cf-connecting-ip')).toBe('192.0.2.1');
  expect(response.headers.has('set-auth-token')).toBe(false);
  expect(response.headers.get('Set-Cookie')).toStartWith('__Host-ro_session=');
});

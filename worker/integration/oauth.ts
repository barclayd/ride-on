import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import { HttpResponse, http } from 'msw';
import { createHarness, type Harness } from './harness.ts';

export const AUTH_ORIGIN = 'https://api.ride-on.test';
export const CLIENT_REDIRECT =
  'https://extension-example.chromiumapp.org/ride-on';
export const CLIENT_ORIGIN = 'https://client.ride-on.test';
export const challenge = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
export const cookiesFrom = (
  headers: { getSetCookie(): string[] },
  previous = '',
) => {
  const jar = new Map(
    previous
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.trim().split('=');
        return [name, value.join('=')];
      }),
  );
  for (const cookie of headers.getSetCookie()) {
    const [pair = ''] = cookie.split(';');
    const [name, ...value] = pair.split('=');
    if (/max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
    else jar.set(name, value.join('='));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
};

type IdentityInput = {
  subject?: string;
  email?: string;
  name?: string;
  audience?: string;
  issuer?: string;
  expired?: boolean;
  badSignature?: boolean;
  verified?: boolean;
};
type Code = IdentityInput & {
  provider: 'google' | 'apple';
  challenge?: string;
  used?: boolean;
};
export const createOAuthHarness = async () => {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const wrongSigning = await generateKeyPair('RS256');
  const appleClient = await generateKeyPair('ES256', { extractable: true });
  const config = {
    secret: 'synthetic-auth-secret-for-integration-tests-only',
    baseUrl: AUTH_ORIGIN,
    trustedOrigins: [CLIENT_ORIGIN],
    clientRedirects: [CLIENT_REDIRECT],
    google: {
      clientId: 'test-google-client',
      clientSecret: 'synthetic-google-secret',
    },
    apple: {
      clientId: 'test-apple-service',
      teamId: 'TESTTEAM',
      keyId: 'test-apple-key',
      privateKey: await exportPKCS8(appleClient.privateKey),
    },
  };
  const h = await createHarness(JSON.stringify(config));
  const codes = new Map<string, Code>();
  const jwk = {
    ...(await exportJWK(signing.publicKey)),
    kid: 'test-provider-key',
    alg: 'RS256',
    use: 'sig',
  };
  const handlers = [
    http.get('https://www.googleapis.com/oauth2/v3/certs', () =>
      HttpResponse.json({ keys: [jwk] }),
    ),
    http.get('https://appleid.apple.com/auth/keys', () =>
      HttpResponse.json({ keys: [jwk] }),
    ),
    ...(['google', 'apple'] as const).map((provider) =>
      http.post(
        provider === 'google'
          ? 'https://oauth2.googleapis.com/token'
          : 'https://appleid.apple.com/auth/token',
        async ({ request }) => {
          const input = new URLSearchParams(await request.text());
          const record = codes.get(input.get('code') ?? '');
          if (!record || record.used || record.provider !== provider)
            return HttpResponse.json(
              { error: 'invalid_grant' },
              { status: 400 },
            );
          record.used = true;
          assert.equal(input.get('grant_type'), 'authorization_code');
          assert.equal(input.get('client_id'), config[provider].clientId);
          assert.equal(
            input.get('redirect_uri'),
            `${AUTH_ORIGIN}/api/auth/callback/${provider}`,
          );
          if (record.challenge)
            assert.equal(
              challenge(input.get('code_verifier') ?? ''),
              record.challenge,
            );
          if (provider === 'google')
            assert.equal(
              input.get('client_secret'),
              config.google.clientSecret,
            );
          else {
            const jwt = await jwtVerify(
              input.get('client_secret') ?? '',
              appleClient.publicKey,
              {
                algorithms: ['ES256'],
                issuer: config.apple.teamId,
                audience: 'https://appleid.apple.com',
                subject: config.apple.clientId,
              },
            );
            assert.equal(jwt.protectedHeader.kid, config.apple.keyId);
          }
          const token = await new SignJWT({
            email: record.email ?? 'rider@example.test',
            email_verified: record.verified ?? true,
            ...(record.name === ''
              ? {}
              : { name: record.name ?? 'Test Rider' }),
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-provider-key' })
            .setIssuer(
              record.issuer ??
                (provider === 'google'
                  ? 'https://accounts.google.com'
                  : 'https://appleid.apple.com'),
            )
            .setAudience(record.audience ?? config[provider].clientId)
            .setSubject(record.subject ?? `${provider}-rider`)
            .setIssuedAt()
            .setExpirationTime(record.expired ? '-1h' : '1h')
            .sign(
              record.badSignature
                ? wrongSigning.privateKey
                : signing.privateKey,
            );
          return HttpResponse.json({
            access_token: 'synthetic-provider-access-token',
            refresh_token: 'synthetic-provider-refresh-token',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: token,
            scope: 'openid email profile',
          });
        },
      ),
    ),
  ];
  h.use(...handlers);
  const callback = async (
    authorizationUrl: string,
    cookies: string,
    identity: IdentityInput = {},
  ) => {
    const url = new URL(authorizationUrl);
    const provider = url.hostname === 'appleid.apple.com' ? 'apple' : 'google';
    const code = crypto.randomUUID();
    codes.set(code, {
      provider,
      ...identity,
      challenge: url.searchParams.get('code_challenge') ?? undefined,
    });
    const params = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      code,
    });
    const path = `/api/auth/callback/${provider}`;
    let response: Awaited<ReturnType<Harness['send']>>;
    if (provider === 'apple') {
      response = await h.send(path, {
        token: null,
        body: params.toString(),
        contentType: 'application/x-www-form-urlencoded',
        headers: { Cookie: cookies, Origin: 'https://appleid.apple.com' },
      });
      assert.equal(response.status, 302);
      response = await h.send(response.headers.get('Location') ?? '', {
        token: null,
        headers: { Cookie: cookies },
      });
    } else
      response = await h.send(`${path}?${params}`, {
        token: null,
        headers: { Cookie: cookies },
      });
    return {
      response,
      cookies: cookiesFrom(response.headers, cookies),
      callbackPath: `${path}?${params}`,
    };
  };
  const begin = async (
    provider: 'google' | 'apple' = 'google',
    cookies = '',
    linking = false,
  ) => {
    const response = await h.send(
      linking ? '/api/auth/link-social' : '/api/auth/sign-in/social',
      {
        token: null,
        body: JSON.stringify({
          provider,
          callbackURL: `${AUTH_ORIGIN}/auth/me`,
          disableRedirect: true,
        }),
        headers: { Origin: AUTH_ORIGIN, Cookie: cookies },
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const body = (await response.json()) as { url: string };
    return {
      url: body.url,
      cookies: cookiesFrom(response.headers, cookies),
      response,
    };
  };
  const login = async (
    provider: 'google' | 'apple' = 'google',
    identity: IdentityInput = {},
  ) => {
    const start = await begin(provider);
    const result = await callback(start.url, start.cookies, identity);
    assert.equal(result.response.status, 302);
    assert.equal(
      result.response.headers.get('Location'),
      `${AUTH_ORIGIN}/auth/me`,
    );
    const token = result.response.headers.get('set-auth-token');
    assert.ok(token, 'Successful login must expose a signed session token');
    return { ...result, token };
  };
  return { h, config, handlers, callback, begin, login };
};
export const closeHarness = async (h: Harness) => {
  await h.dispose();
  assert.deepEqual(
    h.unexpected,
    [],
    'Every outgoing request needs an MSW handler',
  );
  assert.deepEqual(h.handlerErrors, [], 'Provider assertions must pass');
};

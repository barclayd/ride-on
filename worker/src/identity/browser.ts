import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import type { Bindings } from '../types.ts';
import { requireSession } from './access.ts';
import { authConfig, createIdentity } from './config.ts';

const random = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
export const sha256 = async (value: string) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
      ),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const cookieName = '__Host-ride-on.handoff';
const invalidFlow = () =>
  new AppError(
    400,
    'INVALID_LOGIN_FLOW',
    'This login has expired, was already used, or does not match this client.',
  );
type Flow = {
  id: string;
  provider: 'google' | 'apple';
  redirect_uri: string;
  client_state: string;
  challenge: string;
};

const throttle = async (db: D1Database, request: Request, action: string) => {
  const key = await sha256(
    `${action}:${request.headers.get('cf-connecting-ip') ?? 'unknown'}`,
  );
  const window = Math.floor(Date.now() / 60_000);
  const result = await db
    .prepare(`INSERT INTO auth_browser_limits (key, window, count) VALUES (?, ?, 1)
    ON CONFLICT (key) DO UPDATE SET window = excluded.window,
    count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END RETURNING count`)
    .bind(key, window)
    .first<{ count: number }>();
  if (!result || result.count > 30)
    throw new AppError(
      429,
      'LOGIN_RATE_LIMITED',
      'Too many login attempts. Try again in a minute.',
      { 'Retry-After': '60' },
    );
};

export const browserRoutes = () => {
  const app = new Hono<Bindings>();
  app.post('/auth/browser/start', async (c) => {
    const config = authConfig(c.env);
    await throttle(c.env.ROUTES_DB, c.req.raw, 'start');
    const input = await readJsonBody(
      c,
      z.strictObject({
        provider: z.enum(['google', 'apple']),
        redirectUri: z.string().max(2048),
        codeChallenge: opaque,
        state: z
          .string()
          .min(16)
          .max(256)
          .regex(/^[A-Za-z0-9_-]+$/),
      }),
    );
    if (!config.clientRedirects.includes(input.redirectUri))
      throw new AppError(
        400,
        'INVALID_REDIRECT',
        'Register this exact client redirect URL before using it.',
      );
    if (!config[input.provider])
      throw new AppError(
        503,
        'PROVIDER_NOT_CONFIGURED',
        'This login provider is not configured.',
      );
    const id = random();
    const now = Date.now();
    await c.env.ROUTES_DB.batch([
      c.env.ROUTES_DB.prepare(
        'DELETE FROM auth_browser_flows WHERE expires_at < ?',
      ).bind(now),
      c.env.ROUTES_DB.prepare(
        'DELETE FROM auth_browser_limits WHERE window < ?',
      ).bind(Math.floor(now / 60_000) - 10),
      c.env.ROUTES_DB.prepare(`INSERT INTO auth_browser_flows (id, provider, redirect_uri, client_state, challenge, status, expires_at)
        VALUES (?, ?, ?, ?, ?, 'created', ?)`).bind(
        id,
        input.provider,
        input.redirectUri,
        input.state,
        input.codeChallenge,
        now + 600_000,
      ),
    ]);
    return c.json(
      {
        authorizationUrl: `${config.baseUrl}/auth/browser/authorize?request=${id}`,
        expiresIn: 600,
      },
      201,
    );
  });
  app.get('/auth/browser/authorize', async (c) => {
    const id = validateInput(opaque, c.req.query('request'));
    const identity = createIdentity(c.env);
    await throttle(c.env.ROUTES_DB, c.req.raw, 'authorize');
    const flow =
      await c.env.ROUTES_DB.prepare(`UPDATE auth_browser_flows SET status = 'authorizing', started_at = ?
      WHERE id = ? AND status = 'created' AND expires_at > ? RETURNING *`)
        .bind(Date.now(), id, Date.now())
        .first<Flow>();
    if (!flow) throw invalidFlow();
    // Navigate here first so the provider's state cookie is set in a first-party
    // browser context, independent of extension third-party cookie policies.
    const response = await identity.auth.handler(
      new Request(`${identity.config.baseUrl}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: identity.config.baseUrl,
          'cf-connecting-ip': c.req.header('cf-connecting-ip') ?? 'unknown',
        },
        body: JSON.stringify({
          provider: flow.provider,
          disableRedirect: true,
          callbackURL: `${identity.config.baseUrl}/auth/browser/complete?request=${id}`,
        }),
      }),
    );
    if (!response.ok)
      throw new AppError(
        502,
        'LOGIN_START_FAILED',
        'Unable to start sign-in. Please try again.',
      );
    const { url } = validateInput(
      z.object({ url: z.url() }),
      await response.json(),
    );
    const headers = new Headers({ Location: url });
    for (const cookie of response.headers.getSetCookie())
      headers.append('Set-Cookie', cookie);
    headers.append(
      'Set-Cookie',
      `${cookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
    );
    return new Response(null, { status: 302, headers });
  });
  app.get('/auth/browser/complete', async (c) => {
    const id = validateInput(opaque, c.req.query('request'));
    const cookie = c.req
      .header('Cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (cookie !== id) throw invalidFlow();
    const session = await requireSession(c.req.raw, createIdentity(c.env));
    const code = random();
    const flow =
      await c.env.ROUTES_DB.prepare(`UPDATE auth_browser_flows SET status = 'complete', code_hash = ?, session_id = ?, expires_at = ?
      WHERE id = ? AND status = 'authorizing' AND expires_at > ? AND started_at <= ? RETURNING *`)
        .bind(
          await sha256(code),
          session.session.id,
          Date.now() + 60_000,
          id,
          Date.now(),
          session.session.createdAt.getTime(),
        )
        .first<Flow>();
    if (!flow) throw invalidFlow();
    const destination = new URL(flow.redirect_uri);
    destination.searchParams.set('code', code);
    destination.searchParams.set('state', flow.client_state);
    c.header(
      'Set-Cookie',
      `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return c.redirect(destination.href, 302);
  });
  app.post('/auth/browser/exchange', async (c) => {
    const identity = createIdentity(c.env);
    await throttle(c.env.ROUTES_DB, c.req.raw, 'exchange');
    const input = await readJsonBody(
      c,
      z.strictObject({
        code: opaque,
        codeVerifier: z
          .string()
          .min(43)
          .max(128)
          .regex(/^[A-Za-z0-9._~-]+$/),
        redirectUri: z.string().max(2048),
      }),
    );
    if (!identity.config.clientRedirects.includes(input.redirectUri))
      throw invalidFlow();
    // The predicate and consumption are one statement: failed PKCE attempts do
    // not consume another client's code; simultaneous valid exchanges cannot win twice.
    const flow =
      await c.env.ROUTES_DB.prepare(`DELETE FROM auth_browser_flows WHERE code_hash = ? AND challenge = ?
      AND redirect_uri = ? AND status = 'complete' AND expires_at > ? RETURNING session_id`)
        .bind(
          await sha256(input.code),
          await sha256(input.codeVerifier),
          input.redirectUri,
          Date.now(),
        )
        .first<{ session_id: string }>();
    if (!flow) throw invalidFlow();
    const row = await c.env.ROUTES_DB.prepare(
      'SELECT token FROM auth_session WHERE id = ?',
    )
      .bind(flow.session_id)
      .first<{ token: string }>();
    if (!row) throw invalidFlow();
    const session = await identity.auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${row.token}` }),
    });
    if (!session) throw invalidFlow();
    return c.json({
      token: row.token,
      tokenType: 'Bearer',
      expiresAt: session.session.expiresAt,
      user: session.user,
    });
  });
  return app;
};

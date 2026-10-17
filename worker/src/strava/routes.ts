import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { resolveAccess } from '../identity/access.ts';
import { sha256 } from '../identity/browser.ts';
import { authConfig } from '../identity/config.ts';
import { copySessionHeaders } from '../identity/routes.ts';
import { readJsonBody, validateInput } from '../request.ts';
import type { Bindings } from '../types.ts';
import { athleteSchema, bridge, configured, historySchema } from './bridge.ts';
import { startDefaultImport } from './import-service.ts';

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const random = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const cookieName = '__Host-ride-on.strava';
const invalid = () =>
  new AppError(
    400,
    'INVALID_STRAVA_FLOW',
    'This connection expired or does not match this device. Please try again.',
  );
type Flow = {
  id: string;
  owner_id: string;
  client_state: string;
  athlete_id: string | null;
  scopes: string | null;
};
type Connection = {
  owner_id: string;
  athlete_id: string;
  grant_id: string;
  scopes: string;
  connected_at: number;
  generation: string;
};
const connection = (db: D1Database, owner: string) =>
  db
    .prepare('SELECT * FROM strava_connections WHERE owner_id = ?')
    .bind(owner)
    .first<Connection>();
export const throttle = async (db: D1Database, key: string, max = 30) => {
  const window = Math.floor(Date.now() / 60_000);
  const row = await db
    .prepare(`INSERT INTO strava_limits VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET
    window = excluded.window, count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END RETURNING count`)
    .bind(await sha256(key), window)
    .first<{ count: number }>();
  if (!row || row.count > max)
    throw new AppError(
      429,
      'STRAVA_RATE_LIMITED',
      'Please wait a minute before trying again.',
      { 'Retry-After': '60' },
    );
};
export const cleanStravaFlows = async (db: D1Database) => {
  await db.batch([
    db
      .prepare('DELETE FROM strava_flows WHERE expires_at <= ?')
      .bind(Date.now()),
    db
      .prepare('DELETE FROM strava_limits WHERE window < ?')
      .bind(Math.floor(Date.now() / 60_000) - 10),
  ]);
};

export const stravaPublicRoutes = () => {
  const app = new Hono<Bindings>();
  app.get('/integrations/strava/authorize', async (c) => {
    const id = validateInput(opaque, c.req.query('request'));
    // A copied authorize URL cannot link another person's Strava to its sender.
    // Native clients send their session in the initial browser request's header.
    const access = await resolveAccess(c.req.raw, c.env);
    copySessionHeaders(access.headers, c.res.headers);
    await throttle(
      c.env.ROUTES_DB,
      `browser:${c.req.header('cf-connecting-ip') ?? 'unknown'}`,
    );
    const config = await bridge(
      c.env,
      '/configuration',
      z.object({
        clientId: z.string().regex(/^[1-9][0-9]*$/),
        callbackUrl: z.literal(
          'https://stravastitch.com/auth/ride-on/callback',
        ),
        scopes: z.array(z.string()).max(12),
      }),
    );
    const flow =
      await c.env.ROUTES_DB.prepare(`UPDATE strava_flows SET status = 'authorizing'
      WHERE id = ? AND owner_id = ? AND status = 'created' AND expires_at > ? RETURNING id`)
        .bind(id, access.ownerId, Date.now())
        .first();
    if (!flow) throw invalid();
    setCookie(c, cookieName, id, {
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    });
    const url = new URL('https://www.strava.com/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      approval_prompt: 'force',
      scope: config.scopes.join(','),
      state: id,
    }).toString();
    return c.redirect(url.href, 302);
  });
  app.get('/integrations/strava/callback', async (c) => {
    const id = validateInput(opaque, c.req.query('state'));
    const cookie = getCookie(c, cookieName) ?? '';
    if (
      cookie.length !== id.length ||
      !timingSafeEqual(
        new TextEncoder().encode(cookie),
        new TextEncoder().encode(id),
      )
    )
      throw invalid();
    await throttle(
      c.env.ROUTES_DB,
      `callback:${c.req.header('cf-connecting-ip') ?? 'unknown'}`,
    );
    for (const key of ['state', 'code', 'scope', 'error'])
      if ((c.req.queries(key)?.length ?? 0) > 1) throw invalid();
    const flow =
      await c.env.ROUTES_DB.prepare(`UPDATE strava_flows SET status = 'exchanging'
      WHERE id = ? AND status = 'authorizing' AND expires_at > ? RETURNING *`)
        .bind(id, Date.now())
        .first<Flow>();
    if (!flow) throw invalid();
    const done = new URL(
      '/integrations/strava/done',
      authConfig(c.env).baseUrl,
    );
    done.searchParams.set('state', flow.client_state);
    let outcome = 'failed';
    try {
      if (c.req.query('error')) {
        outcome = 'cancelled';
      } else {
        const code = validateInput(
          z.string().min(1).max(2048),
          c.req.query('code'),
        );
        const scopes = validateInput(
          z.string().max(512),
          c.req.query('scope') ?? '',
        );
        const athlete = await bridge(c.env, '/exchange', athleteSchema, {
          code,
          scopes,
        });
        const updated =
          await c.env.ROUTES_DB.prepare(`UPDATE strava_flows SET status = 'ready', athlete_id = ?, grant_id = ?, scopes = ?, expires_at = ?
          WHERE id = ? AND status = 'exchanging' AND expires_at > ? RETURNING id`)
            .bind(
              athlete.athleteId,
              athlete.grantId,
              JSON.stringify(athlete.scopes),
              Date.now() + 60_000,
              id,
              Date.now(),
            )
            .first();
        if (updated) outcome = 'ready';
      }
    } catch {
      /* Only a fixed outcome reaches the client, never upstream bodies or tokens. */
    }
    if (outcome !== 'ready')
      await c.env.ROUTES_DB.prepare('DELETE FROM strava_flows WHERE id = ?')
        .bind(id)
        .run();
    deleteCookie(c, cookieName, {
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    done.searchParams.set('result', outcome);
    return c.redirect(done.href, 302);
  });
  app.get('/integrations/strava/done', (c) =>
    c.text('Return to Ride On to finish connecting Strava.'),
  );
  return app;
};

export const stravaRoutes = () => {
  const app = new Hono<Bindings>();
  app.get('/connections/strava', async (c) => {
    if (!configured(c.env))
      return c.json({ configured: false, connection: null });
    const row = await connection(c.env.ROUTES_DB, c.get('ownerId'));
    if (!row) return c.json({ configured: true, connection: null });
    try {
      const athlete = await bridge(
        c.env,
        `/connection/${row.athlete_id}?grant=${row.grant_id}`,
        athleteSchema,
      );
      return c.json({
        configured: true,
        connection: {
          status: 'connected',
          athleteId: row.athlete_id,
          connectedAt: new Date(row.connected_at).toISOString(),
          privateActivities: athlete.scopes.includes('activity:read_all'),
        },
      });
    } catch (error) {
      if (!(error instanceof AppError) || ![409, 403].includes(error.status))
        throw error;
      return c.json({
        configured: true,
        connection: {
          status: 'needs-reauthorisation',
          athleteId: row.athlete_id,
          connectedAt: new Date(row.connected_at).toISOString(),
          privateActivities: false,
        },
      });
    }
  });
  app.post('/connections/strava/start', async (c) => {
    if (!configured(c.env))
      throw new AppError(
        503,
        'STRAVA_NOT_CONFIGURED',
        'Strava is not available yet.',
      );
    const input = await readJsonBody(
      c,
      z.strictObject({
        state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
        codeChallenge: opaque,
      }),
    );
    await throttle(c.env.ROUTES_DB, `start:${c.get('ownerId')}`, 5);
    const id = random();
    await cleanStravaFlows(c.env.ROUTES_DB);
    await c.env.ROUTES_DB.prepare(`INSERT INTO strava_flows(id, owner_id, client_state, challenge, status, expires_at)
      VALUES (?, ?, ?, ?, 'created', ?) ON CONFLICT(owner_id) DO UPDATE SET id = excluded.id, client_state = excluded.client_state,
      challenge = excluded.challenge, status = 'created', expires_at = excluded.expires_at, athlete_id = NULL, grant_id = NULL, scopes = NULL`)
      .bind(
        id,
        c.get('ownerId'),
        input.state,
        input.codeChallenge,
        Date.now() + 600_000,
      )
      .run();
    return c.json(
      {
        requestId: id,
        authorizationUrl: `${authConfig(c.env).baseUrl}/integrations/strava/authorize?request=${id}`,
        expiresIn: 600,
      },
      201,
    );
  });
  app.post('/connections/strava/complete', async (c) => {
    if (!configured(c.env))
      throw new AppError(
        503,
        'STRAVA_NOT_CONFIGURED',
        'Strava is not available yet.',
      );
    const input = await readJsonBody(
      c,
      z.strictObject({
        requestId: opaque,
        codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      }),
    );
    await throttle(c.env.ROUTES_DB, `complete:${c.get('ownerId')}`);
    const challenge = await sha256(input.codeVerifier);
    let results: D1Result<Connection>[];
    try {
      results = await c.env.ROUTES_DB.batch<Connection>([
        c.env.ROUTES_DB.prepare(`INSERT INTO strava_connections(owner_id, athlete_id, grant_id, scopes, connected_at, generation)
          SELECT owner_id, athlete_id, grant_id, scopes, ?, id FROM strava_flows
          WHERE id = ? AND owner_id = ? AND challenge = ? AND status = 'ready' AND expires_at > ?
          ON CONFLICT(owner_id) DO UPDATE SET athlete_id = excluded.athlete_id, grant_id = excluded.grant_id, scopes = excluded.scopes,
          connected_at = excluded.connected_at, generation = excluded.generation RETURNING *`).bind(
          Date.now(),
          input.requestId,
          c.get('ownerId'),
          challenge,
          Date.now(),
        ),
        c.env.ROUTES_DB.prepare(
          `DELETE FROM strava_flows WHERE id = ? AND owner_id = ? AND challenge = ? AND status = 'ready'`,
        ).bind(input.requestId, c.get('ownerId'), challenge),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(
          'UNIQUE constraint failed: strava_connections.athlete_id',
        )
      )
        throw new AppError(
          409,
          'STRAVA_ALREADY_LINKED',
          'This Strava account is connected to another Ride On account.',
        );
      throw error;
    }
    const connected = results[0]?.results[0];
    if (!connected) throw invalid();
    try {
      await startDefaultImport(c.env, connected);
    } catch {
      console.error('Strava initial import will retry on schedule');
    }
    return c.json({ connected: true });
  });
  app.get('/connections/strava/rides', async (c) => {
    const { page } = validateInput(
      z.strictObject({
        page: z.coerce.number().int().min(1).max(9999).default(1),
      }),
      c.req.query(),
    );
    await throttle(c.env.ROUTES_DB, `rides:${c.get('ownerId')}`);
    const row = await connection(c.env.ROUTES_DB, c.get('ownerId'));
    if (!row)
      throw new AppError(
        409,
        'STRAVA_NOT_CONNECTED',
        'Connect Strava to view your completed rides.',
      );
    const history = await bridge(
      c.env,
      `/rides/${row.athlete_id}?page=${page}&grant=${row.grant_id}`,
      historySchema,
    );
    // A disconnect/account switch must win over a slow upstream request.
    if (
      (await connection(c.env.ROUTES_DB, c.get('ownerId')))?.generation !==
      row.generation
    )
      throw new AppError(
        409,
        'STRAVA_NOT_CONNECTED',
        'The Strava connection changed. Please reload.',
      );
    return c.json({ ...history, page });
  });
  app.delete('/connections/strava', async (c) => {
    await c.env.ROUTES_DB.batch([
      c.env.ROUTES_DB.prepare(
        'DELETE FROM strava_flows WHERE owner_id = ?',
      ).bind(c.get('ownerId')),
      c.env.ROUTES_DB.prepare(
        'DELETE FROM strava_connections WHERE owner_id = ?',
      ).bind(c.get('ownerId')),
    ]);
    return c.json({
      disconnected: true,
      message:
        'Strava is disconnected from Ride On. Ride On’s connection data has been deleted. Stitch’s connection remains available.',
    });
  });
  return app;
};

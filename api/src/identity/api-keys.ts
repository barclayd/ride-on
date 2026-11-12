import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import type { Bindings, Env } from '../types.ts';
import { existingOwner, requireSession } from './access.ts';
import { createIdentity } from './config.ts';
import { agentScopes } from './mcp.ts';
import { copySessionHeaders } from './routes.ts';

const DAY = 86_400_000;
const RATE_LIMIT = 60;
const metadataColumns =
  'id, name, prefix, scopes, created_at, expires_at, revoked_at, last_used_at';
type KeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
};
const metadata = (row: KeyRecord) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: JSON.parse(row.scopes) as string[],
  createdAt: new Date(row.created_at).toISOString(),
  expiresAt: new Date(row.expires_at).toISOString(),
  revokedAt:
    row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
  lastUsedAt:
    row.last_used_at === null ? null : new Date(row.last_used_at).toISOString(),
});
const hashKey = async (token: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
const createKeySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(agentScopes))
    .min(1)
    .max(agentScopes.length)
    .refine(
      (scopes) => new Set(scopes).size === scopes.length,
      'Scopes must be unique.',
    ),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});
const listKeysSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

// Account sessions manage credentials; API keys and MCP grants cannot mint keys.
export const apiKeyRoutes = () => {
  const app = new Hono<Bindings>();
  app.use('/auth/api-keys/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  const session = async (c: Context<Bindings>, fresh = false) => {
    const account = await requireSession(
      c.req.raw,
      createIdentity(c.env),
      fresh,
    );
    copySessionHeaders(account.headers, c.res.headers);
    return account;
  };
  app.post('/auth/api-keys', async (c) => {
    const account = await session(c, true);
    const input = await readJsonBody(c, createKeySchema);
    if (!(await existingOwner(c.env.ROUTES_DB, account.user.id)))
      throw new AppError(
        403,
        'PROFILE_REQUIRED',
        'Finish setting up your rider profile in Ride On before creating an API key.',
      );
    const now = Date.now();
    const key = `ro_agent_${Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`;
    const row = await c.env.ROUTES_DB.prepare(`
      INSERT INTO agent_api_keys (id, user_id, name, prefix, token_hash, scopes, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM agent_api_keys WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) < 20
      RETURNING ${metadataColumns}
    `)
      .bind(
        crypto.randomUUID(),
        account.user.id,
        input.name,
        key.slice(0, 17),
        await hashKey(key),
        JSON.stringify(input.scopes),
        now,
        now + input.expiresInDays * DAY,
        account.user.id,
        now,
      )
      .first<KeyRecord>();
    if (!row)
      throw new AppError(
        409,
        'API_KEY_LIMIT',
        'Revoke an unused API key before creating another (20 active keys maximum).',
      );
    // The full key exists only in this response. It cannot be retrieved later.
    return c.json({ key, ...metadata(row) }, 201);
  });
  app.get('/auth/api-keys', async (c) => {
    const account = await session(c);
    const { limit, cursor } = validateInput(listKeysSchema, c.req.query());
    const rows =
      await c.env.ROUTES_DB.prepare(`SELECT ${metadataColumns} FROM agent_api_keys
      WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?`)
        .bind(account.user.id, cursor ?? '', limit + 1)
        .all<KeyRecord>();
    const keys = rows.results.slice(0, limit);
    return c.json({
      keys: keys.map(metadata),
      nextCursor: rows.results.length > limit ? keys.at(-1)?.id : null,
    });
  });
  app.delete('/auth/api-keys/:id', async (c) => {
    // Revocation is allowed from any active account session, including an older
    // one, so a suspected compromised key can be stopped without a new login.
    const account = await session(c);
    const id = validateInput(z.uuid(), c.req.param('id'));
    const row =
      await c.env.ROUTES_DB.prepare(`UPDATE agent_api_keys SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ? AND user_id = ? RETURNING id`)
        .bind(Date.now(), id, account.user.id)
        .first();
    if (!row)
      throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
    return c.body(null, 204);
  });
  return app;
};

const unauthorizedKey = () =>
  new AppError(401, 'INVALID_API_KEY', 'A valid account API key is required.', {
    'WWW-Authenticate': 'Bearer realm="ride-on-agent-api"',
  });

export const requireApiKey = async (request: Request, env: Env) => {
  // No cookies, query keys, app sessions or OAuth token fallback on this API.
  const match = /^Bearer (ro_agent_[a-f0-9]{64})$/i.exec(
    request.headers.get('Authorization') ?? '',
  );
  if (!match?.[1]) throw unauthorizedKey();
  const tokenHash = await hashKey(match[1]);
  const now = Date.now();
  const window = Math.floor(now / 60_000);
  // Start on the primary even if read replication is enabled later. Never cache
  // a credential decision: revocation and expiry apply to each new request.
  const db = env.ROUTES_DB.withSession('first-primary');
  const key = await db
    .prepare(`SELECT k.id, k.scopes, o.owner_id FROM agent_api_keys k
    JOIN auth_user_owners o ON o.auth_user_id = k.user_id
    WHERE k.token_hash = ? AND k.revoked_at IS NULL AND k.expires_at > ?`)
    .bind(tokenHash, now)
    .first<{ id: string; scopes: string; owner_id: string }>();
  if (!key) throw unauthorizedKey();
  // Atomic fixed-window admission prevents parallel requests bypassing limits.
  const admitted = await db
    .prepare(`UPDATE agent_api_keys SET last_used_at = MAX(COALESCE(last_used_at, 0), ?), request_window = MAX(request_window, ?),
    request_count = CASE WHEN request_window >= ? THEN request_count + 1 ELSE 1 END
    WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
    AND (request_window < ? OR request_count < ?) RETURNING id`)
    .bind(now, window, window, key.id, now, window, RATE_LIMIT)
    .first();
  if (!admitted) {
    const active = await db
      .prepare(
        'SELECT id FROM agent_api_keys WHERE id = ? AND revoked_at IS NULL AND expires_at > ?',
      )
      .bind(key.id, now)
      .first();
    if (!active) throw unauthorizedKey();
    throw new AppError(
      429,
      'RATE_LIMITED',
      'API key request limit reached (60 requests per minute).',
      {
        'Retry-After': String(60 - (Math.floor(now / 1000) % 60)),
      },
    );
  }
  return { ownerId: key.owner_id, scopes: JSON.parse(key.scopes) as string[] };
};

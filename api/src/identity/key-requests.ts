import { type Context, Hono } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody, validateInput } from '../request.ts';
import type { Bindings } from '../types.ts';
import { existingOwner, requireSession, sessionHeaders } from './access.ts';
import { agentPage, agentPageHeaders } from './agent-pages.ts';
import {
  createKeySchema,
  hashKey,
  type KeyRecord,
  keyMetadata,
  metadataColumns,
} from './api-keys.ts';
import { authConfig, createIdentity } from './config.ts';
import { scopeDescriptions } from './mcp.ts';
import { copySessionHeaders } from './routes.ts';

const DAY = 86_400_000;
const LIFETIME = 15 * 60_000;
const requestId = z.string().regex(/^[a-f0-9]{64}$/);
type KeyRequest = {
  id: string;
  key_id: string;
  token_hash: string;
  prefix: string;
  name: string;
  scopes: string;
  expires_in_days: number;
  status: 'pending' | 'approved' | 'denied';
  user_id: string | null;
  expires_at: number;
};
const invalid = () =>
  new AppError(
    400,
    'INVALID_KEY_REQUEST',
    'This setup has expired or is no longer available. Start again from your agent.',
  );
const comparisonCode = (id: string) =>
  `${id.slice(0, 4)}-${id.slice(4, 8)}`.toUpperCase();
const proof = async (c: Context<Bindings>) => {
  const token = /^Bearer (ro_agent_[a-f0-9]{64})$/.exec(
    c.req.header('Authorization') ?? '',
  )?.[1];
  if (!token)
    throw new AppError(
      401,
      'SETUP_PROOF_REQUIRED',
      'The requesting computer must provide its setup credential.',
    );
  return {
    hash: await hashKey(token),
    prefix: token.slice(0, 17),
  };
};
const throttle = async (
  c: Context<Bindings>,
  action: string,
  maximum: number,
) => {
  const key = await hashKey(
    `key-setup:${action}:${c.req.header('cf-connecting-ip') ?? 'unknown'}`,
  );
  const window = Math.floor(Date.now() / 60_000);
  const db = c.env.ROUTES_DB;
  const row = await db
    .prepare(`INSERT INTO auth_browser_limits (key, window, count) VALUES (?, ?, 1)
    ON CONFLICT (key) DO UPDATE SET window = MAX(window, excluded.window),
    count = CASE WHEN window >= excluded.window THEN count + 1 ELSE 1 END RETURNING count`)
    .bind(key, window)
    .first<{ count: number }>();
  if (!row || row.count > maximum)
    throw new AppError(
      429,
      'SETUP_RATE_LIMITED',
      'Too many setup requests. Try again in a minute.',
      { 'Retry-After': '60' },
    );
};
const readRequest = (c: Context<Bindings>, id: string) =>
  c.env.ROUTES_DB.withSession('first-primary')
    .prepare('SELECT * FROM agent_key_requests WHERE id = ? AND expires_at > ?')
    .bind(id, Date.now() - DAY)
    .first<KeyRequest>();
const readProof = (c: Context<Bindings>, hash: string) =>
  c.env.ROUTES_DB.withSession('first-primary')
    .prepare(
      'SELECT * FROM agent_key_requests WHERE token_hash = ? AND expires_at > ?',
    )
    .bind(hash, Date.now() - DAY)
    .first<KeyRequest>();
const status = (row: KeyRequest) =>
  row.status === 'pending' && row.expires_at <= Date.now()
    ? 'expired'
    : row.status;

// This is an internal API-key pairing protocol, not an OAuth device grant.
// The computer generates and durably saves its random key before starting.
// The phone approves its hash; neither a session nor a secret crosses devices.
export const keyRequestRoutes = () => {
  const app = new Hono<Bindings>();
  app.use('/auth/api-key-requests*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.post('/auth/api-key-requests', async (c) => {
    await throttle(c, 'start', 5);
    const credential = await proof(c);
    const input = await readJsonBody(c, createKeySchema);
    const db = c.env.ROUTES_DB.withSession('first-primary');
    await db.batch([
      db
        .prepare('DELETE FROM agent_key_requests WHERE expires_at < ?')
        .bind(Date.now() - DAY),
      db
        .prepare('DELETE FROM auth_browser_limits WHERE window < ?')
        .bind(Math.floor(Date.now() / 60_000) - 10),
      db
        .prepare(`INSERT INTO agent_key_requests (id, key_id, token_hash, prefix, name, scopes, expires_in_days, status, expires_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?
        WHERE NOT EXISTS (SELECT 1 FROM agent_api_keys WHERE token_hash = ?)
        ON CONFLICT(token_hash) DO NOTHING`)
        .bind(
          await hashKey(crypto.randomUUID()),
          crypto.randomUUID(),
          credential.hash,
          credential.prefix,
          input.name,
          JSON.stringify(input.scopes),
          input.expiresInDays,
          Date.now() + LIFETIME,
          credential.hash,
        ),
    ]);
    const row = await readProof(c, credential.hash);
    if (
      !row ||
      row.name !== input.name ||
      row.scopes !== JSON.stringify(input.scopes) ||
      row.expires_in_days !== input.expiresInDays
    )
      throw new AppError(
        409,
        'SETUP_CONFLICT',
        'This credential already belongs to another setup. Resume the original request.',
      );
    return c.json(
      {
        requestId: row.id,
        verificationUri: `${authConfig(c.env).baseUrl}/auth/agents/key?request=${row.id}`,
        userCode: comparisonCode(row.id),
        expiresAt: new Date(row.expires_at).toISOString(),
        interval: 5,
        status: status(row),
      },
      201,
    );
  });
  app.post('/auth/api-key-requests/status', async (c) => {
    await throttle(c, 'poll', 30);
    const credential = await proof(c);
    await readJsonBody(c, z.strictObject({}));
    const row = await readProof(c, credential.hash);
    if (!row) throw invalid();
    if (row.status !== 'approved') return c.json({ status: status(row) });
    const db = c.env.ROUTES_DB.withSession('first-primary');
    const key = await db
      .prepare(
        `SELECT ${metadataColumns} FROM agent_api_keys WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(row.key_id, credential.hash, Date.now())
      .first<KeyRecord>();
    if (!key) throw invalid();
    const user = await db
      .prepare('SELECT email FROM auth_user WHERE id = ?')
      .bind(row.user_id)
      .first<{ email: string }>();
    return c.json({
      status: 'approved',
      credential: keyMetadata(key),
      account: { email: user?.email },
    });
  });
  app.post('/auth/api-key-requests/decision', async (c) => {
    await throttle(c, 'decision', 30);
    const account = await requireSession(
      c.req.raw,
      createIdentity(c.env),
      true,
    );
    copySessionHeaders(account.headers, c.res.headers);
    const input = await readJsonBody(
      c,
      z.strictObject({
        requestId,
        userCode: z.string().regex(/^[A-F0-9]{4}-[A-F0-9]{4}$/),
        accept: z.boolean(),
      }),
    );
    const row = await readRequest(c, input.requestId);
    if (
      !row ||
      input.userCode !== comparisonCode(row.id) ||
      row.status === 'denied' ||
      (row.status === 'approved' && row.user_id !== account.user.id)
    )
      throw invalid();
    if (row.status === 'approved') return c.json({ status: 'approved' });
    if (row.expires_at <= Date.now()) throw invalid();
    const db = c.env.ROUTES_DB.withSession('first-primary');
    if (!input.accept) {
      const denied = await db
        .prepare(
          "UPDATE agent_key_requests SET status = 'denied', user_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ? RETURNING id",
        )
        .bind(account.user.id, row.id, Date.now())
        .first();
      if (!denied) throw invalid();
      return c.json({ status: 'denied' });
    }
    if (!(await existingOwner(c.env.ROUTES_DB, account.user.id)))
      throw new AppError(
        403,
        'PROFILE_REQUIRED',
        'Sign in to the Ride On account that already owns your rider profile.',
      );
    const now = Date.now();
    // Insert and approval form one transaction. Parallel approvals cannot create
    // duplicate keys, change the account, or exceed the existing account limit.
    const results = await db.batch([
      db
        .prepare(`INSERT INTO agent_api_keys (id, user_id, name, prefix, token_hash, scopes, created_at, expires_at)
        SELECT key_id, ?, name, prefix, token_hash, scopes, ?, ? + expires_in_days * ?
        FROM agent_key_requests WHERE id = ? AND status = 'pending' AND expires_at > ?
        AND (SELECT COUNT(*) FROM agent_api_keys WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) < 20`)
        .bind(
          account.user.id,
          now,
          now,
          DAY,
          row.id,
          now,
          account.user.id,
          now,
        ),
      db
        .prepare(`UPDATE agent_key_requests SET status = 'approved', user_id = ?
        WHERE id = ? AND status = 'pending' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM agent_api_keys WHERE id = agent_key_requests.key_id AND user_id = ?)
        RETURNING id`)
        .bind(account.user.id, row.id, now, account.user.id),
    ]);
    if (!results[1]?.results.length) {
      const latest = await readRequest(c, row.id);
      if (latest?.status === 'approved' && latest.user_id === account.user.id)
        return c.json({ status: 'approved' });
      if (latest?.status !== 'pending') throw invalid();
      throw new AppError(
        409,
        'API_KEY_LIMIT',
        'Revoke an unused API key before creating another (20 active keys maximum).',
      );
    }
    return c.json({ status: 'approved' });
  });
  app.get('/auth/agents/key', async (c) => {
    agentPageHeaders(c);
    await throttle(c, 'page', 60);
    const id = validateInput(requestId, c.req.query('request'));
    const row = await readRequest(c, id);
    const footer = html`<p class="muted">Only approve a setup you requested. The agent’s name is supplied by the requesting computer.</p>`;
    if (!row || status(row) === 'expired' || row.status === 'denied')
      return c.html(
        agentPage(
          'key-closed',
          html`<h1>Setup ${row?.status === 'denied' ? 'cancelled' : 'expired'}</h1><p>This request can no longer be approved. Return to your agent to check the setup status.</p>`,
          footer,
        ),
      );
    const identity = createIdentity(c.env);
    const account = await identity.auth.api.getSession({
      headers: sessionHeaders(c.req.raw),
    });
    const fresh =
      account && Date.now() - account.session.createdAt.getTime() <= 600_000;
    const requestInput = html`<input type="hidden" id="key-request" value="${row.id}">`;
    if (!fresh)
      return c.html(
        agentPage(
          'key-sign-in',
          html`${requestInput}<h1>Connect ${row.name}</h1><p>Sign in on this phone to approve access to your Ride On preferences and routes. You won’t need to use your computer.</p><section>${(['apple', 'google'] as const).filter((provider) => identity.config[provider]).map((provider) => html`<button type="button" data-provider="${provider}">Continue with ${provider === 'apple' ? 'Apple' : 'Google'}</button>`)}</section><p class="muted">You’ll review the account and permissions before granting access.</p>`,
          footer,
        ),
      );
    if (row.status === 'approved') {
      if (row.user_id !== account.user.id) throw invalid();
      return c.html(
        agentPage(
          'key-approved',
          html`<h1>Access approved</h1><p>${row.name} can now finish connecting to Ride On on the requesting computer. You can close this tab.</p>`,
          footer,
        ),
      );
    }
    return c.html(
      agentPage(
        'key-consent',
        html`${requestInput}<h1>Allow ${row.name} to use Ride On?</h1><p class="account">Signed in as <strong>${account.user.email}</strong></p><section><h2>Check the setup code</h2><p class="setup-code" id="setup-code">${comparisonCode(id)}</p><p>Check that this matches the code your agent gave you.</p></section><section><h2>Permissions</h2><ul>${(JSON.parse(row.scopes) as string[]).map((scope) => html`<li>${scopeDescriptions[scope]}</li>`)}</ul><p>Access lasts ${row.expires_in_days} days. The key will be held by the requesting computer.</p></section><label><input type="checkbox" id="confirm-setup"> I requested this setup and the code matches</label><p><button class="primary" type="button" id="approve-key" disabled>Allow access</button><button type="button" id="deny-key">Cancel</button></p><p><button type="button" id="switch-key">Use a different account</button></p>`,
        footer,
      ),
    );
  });
  return app;
};

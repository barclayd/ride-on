import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { readJsonBody } from '../request.ts';
import type { Bindings } from '../types.ts';
import { requireSession } from './access.ts';
import { createIdentity, type Identity } from './config.ts';
import { scopeDescriptions } from './mcp.ts';

const verifiedQuery = async (request: Request, identity: Identity) => {
  const params = new URL(request.url).searchParams;
  const signed = new Set(['sig', 'ba_param', ...params.getAll('ba_param')]);
  const query = new URLSearchParams(
    [...params].filter(([key]) => signed.has(key)),
  ).toString();
  if (
    !(await verifyOAuthQueryParams(
      query,
      (
        await identity.auth.$context
      ).secret,
    ))
  )
    throw new AppError(
      400,
      'INVALID_AUTHORISATION',
      'This connection request is invalid or expired. Start again from your agent.',
    );
  return new URLSearchParams(query);
};
const page = (
  mode: string,
  content: ReturnType<typeof html>,
) => html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Agent access · Ride On</title><style>
:root{font:17px/1.55 system-ui,sans-serif;color-scheme:light dark;accent-color:#248a3d}body{margin:0;background:Canvas;color:CanvasText}main{max-width:34rem;margin:7vh auto;padding:1.5rem}h1{font-size:2rem;line-height:1.15;letter-spacing:-.04em}h2{font-size:1.1rem}p{margin:.8rem 0}.brand{font-weight:700;color:#248a3d}.muted{color:GrayText;font-size:.9rem}section{border-block-start:1px solid GrayText;padding:1rem 0;margin-top:1.5rem}button{font:inherit;border:1px solid GrayText;border-radius:.6rem;padding:.65rem 1rem;margin:.4rem .5rem .4rem 0;background:ButtonFace;color:ButtonText;cursor:pointer}button.primary{background:#248a3d;color:white;border-color:#248a3d}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible{outline:3px solid Highlight;outline-offset:3px}a{color:LinkText}li{margin:.65rem 0;overflow-wrap:anywhere}[hidden]{display:none!important}.account{overflow-wrap:anywhere}@media(prefers-color-scheme:dark){.brand{color:#30d158}}
</style><script src="/auth/agents/page.js" defer></script></head><body><main data-mode="${mode}"><p class="brand">Ride On</p>${content}<p id="status" role="status" aria-live="polite"></p><p class="muted">You can disconnect an agent at any time from <a href="/auth/agents">Agent access</a>.</p></main></body></html>`;

export const agentPageScript = `
'use strict';
const status = document.getElementById('status');
const mode = document.querySelector('main').dataset.mode;
const request = async (path, body) => {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || data.message || 'Could not complete this request. Please try again.');
  return data;
};
const query = new URLSearchParams(location.search);
const signed = new Set(['sig', 'ba_param', ...query.getAll('ba_param')]);
const oauthQuery = new URLSearchParams([...query].filter(([key]) => signed.has(key))).toString();
const go = url => { const target = new URL(url); if (!['https:', 'http:'].includes(target.protocol) && !target.protocol.includes('claude') && !target.protocol.includes('codex')) throw new Error('Return to your agent to finish connecting.'); location.assign(target.href); };
const act = async (button, action) => { button.disabled = true; status.textContent = ''; try { await action(); } catch (error) { status.textContent = error.message; button.disabled = false; } };
document.querySelectorAll('[data-provider]').forEach(button => button.onclick = () => act(button, async () => {
  const callbackURL = location.origin + (oauthQuery ? '/auth/agents/consent?' + oauthQuery : '/auth/agents');
  const result = await request('/api/auth/sign-in/social', { provider: button.dataset.provider, callbackURL, errorCallbackURL: location.href, disableRedirect: true, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) });
  go(result.url);
}));
document.querySelectorAll('[data-accept]').forEach(button => button.onclick = () => act(button, async () => {
  const accept = button.dataset.accept === 'true';
  const scope = [...document.querySelectorAll('input[name="scope"]:checked')].map(input => input.value).join(' ');
  const result = await request('/api/auth/oauth2/consent', { accept, scope, oauth_query: oauthQuery });
  go(result.url);
}));
const switchButton = document.getElementById('switch');
if (switchButton) switchButton.onclick = () => act(switchButton, async () => { await request('/api/auth/sign-out', {}); location.assign('/auth/agents/sign-in?' + oauthQuery); });
if (mode === 'connections') request('/auth/agents/connections').then(({ connections }) => {
  const list = document.getElementById('connections');
  if (!connections.length) { list.textContent = 'No agents are connected to this account.'; return; }
  connections.forEach(connection => {
    const section = document.createElement('section'); const heading = document.createElement('h2'); heading.textContent = connection.name || 'Connected agent';
    const description = document.createElement('p'); description.textContent = connection.permissions.join(' · ');
    const button = document.createElement('button'); button.textContent = 'Disconnect';
    button.onclick = () => act(button, async () => { await request('/auth/agents/revoke', { clientId: connection.clientId }); section.remove(); status.textContent = 'Agent disconnected. Its access has been revoked.'; });
    section.append(heading, description, button); list.append(section);
  });
}).catch(error => { status.textContent = error.message; });
`;

export const agentPages = () => {
  const app = new Hono<Bindings>();
  app.use('/auth/agents*', async (c, next) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.get('/auth/agents/page.js', (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    return c.body(agentPageScript);
  });
  app.get('/auth/agents/sign-in', async (c) => {
    const identity = createIdentity(c.env);
    if (new URL(c.req.url).search) await verifiedQuery(c.req.raw, identity);
    const providers = (['apple', 'google'] as const).filter(
      (provider) => identity.config[provider],
    );
    return c.html(
      page(
        'sign-in',
        html`<h1>Connect your agent</h1><p>Sign in to the Ride On account whose preferences and routes you want your agent to use.</p><section>${providers.map((provider) => html`<button type="button" data-provider="${provider}">Continue with ${provider === 'apple' ? 'Apple' : 'Google'}</button>`)}${!providers.length ? html`<p>Sign-in is temporarily unavailable. Please try again later.</p>` : ''}</section><p class="muted">You’ll review the permissions before any access is granted.</p>`,
      ),
    );
  });
  app.get('/auth/agents/consent', async (c) => {
    const identity = createIdentity(c.env);
    const query = await verifiedQuery(c.req.raw, identity);
    const session = await requireSession(c.req.raw, identity);
    const client = await identity.auth.api.getOAuthClientPublic({
      query: { client_id: query.get('client_id') ?? '' },
      headers: c.req.raw.headers,
    });
    const redirect = new URL(query.get('redirect_uri') ?? '');
    const scopes = (query.get('scope') ?? '').split(' ').filter(Boolean);
    if (scopes.some((scope) => !(scope in scopeDescriptions)))
      throw new AppError(
        400,
        'INVALID_SCOPE',
        'This connection requested an unsupported permission.',
      );
    return c.html(
      page(
        'consent',
        html`<h1>Allow ${client.client_name || 'this agent'} to use Ride On?</h1><p class="account">Signed in as <strong>${session.user.email}</strong></p><p>The agent’s name is supplied by its developer. You’ll return to <strong>${redirect.host || redirect.protocol}</strong>.</p><section><h2>Permissions</h2><ul>${scopes.map((scope) => html`<li><label><input type="checkbox" name="scope" value="${scope}" checked> ${scopeDescriptions[scope]}</label></li>`)}</ul></section><button class="primary" type="button" data-accept="true">Allow access</button><button type="button" data-accept="false">Cancel</button><p><button id="switch" type="button">Use a different account</button></p>`,
      ),
    );
  });
  app.get('/auth/agents', async (c) => {
    const identity = createIdentity(c.env);
    const session = await identity.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) return c.redirect('/auth/agents/sign-in');
    return c.html(
      page(
        'connections',
        html`<h1>Your connected agents</h1><p class="account">${session.user.email}</p><p>Manage which agents can use your personal preferences and route library.</p><div id="connections"></div>`,
      ),
    );
  });
  app.get('/auth/agents/connections', async (c) => {
    const session = await requireSession(c.req.raw, createIdentity(c.env));
    const rows = await c.env.ROUTES_DB.prepare(
      'SELECT c.clientId, c.scopes, a.name FROM oauthConsent c JOIN oauthClient a ON a.clientId = c.clientId WHERE c.userId = ? ORDER BY c.createdAt DESC',
    )
      .bind(session.user.id)
      .all<{ clientId: string; scopes: string; name: string | null }>();
    return c.json({
      connections: rows.results.map((row) => ({
        clientId: row.clientId,
        name: row.name,
        permissions: (JSON.parse(row.scopes) as string[]).map(
          (scope) => scopeDescriptions[scope] ?? scope,
        ),
      })),
    });
  });
  app.post('/auth/agents/revoke', async (c) => {
    const session = await requireSession(c.req.raw, createIdentity(c.env));
    const { clientId } = await readJsonBody(
      c,
      z.strictObject({ clientId: z.string().min(1).max(2048) }),
    );
    await c.env.ROUTES_DB.batch([
      c.env.ROUTES_DB.prepare(
        'DELETE FROM oauthAccessToken WHERE userId = ? AND clientId = ?',
      ).bind(session.user.id, clientId),
      c.env.ROUTES_DB.prepare(
        'DELETE FROM oauthRefreshToken WHERE userId = ? AND clientId = ?',
      ).bind(session.user.id, clientId),
      c.env.ROUTES_DB.prepare(
        'DELETE FROM oauthConsent WHERE userId = ? AND clientId = ?',
      ).bind(session.user.id, clientId),
    ]);
    return c.json({ revoked: true });
  });
  return app;
};

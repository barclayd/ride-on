import { Hono } from 'hono';
import { z } from 'zod';
import { readBoundedBody } from '../body.ts';
import { AppError } from '../errors.ts';
import { readJsonBody } from '../request.ts';
import type { Bindings } from '../types.ts';
import {
  checkCookieOrigin,
  existingOwner,
  requireSession,
  sessionHeaders,
} from './access.ts';
import { browserRoutes } from './browser.ts';
import { authConfig, createIdentity } from './config.ts';

export const copySessionHeaders = (from: Headers, to: Headers) => {
  for (const cookie of from.getSetCookie()) to.append('Set-Cookie', cookie);
  const token = from.get('set-auth-token');
  if (token) to.set('set-auth-token', token);
};

const socialInput = z.strictObject({
  provider: z.enum(['google', 'apple']),
  callbackURL: z.string().max(2048).optional(),
  errorCallbackURL: z.string().max(2048).optional(),
  newUserCallbackURL: z.string().max(2048).optional(),
  disableRedirect: z.boolean().optional(),
});
const allowed = new Map([
  ['/sign-in/social', ['POST']],
  ['/link-social', ['POST']],
  ['/unlink-account', ['POST']],
  ['/get-session', ['GET']],
  ['/sign-out', ['POST']],
  ['/list-sessions', ['GET']],
  ['/revoke-session', ['POST']],
  ['/revoke-sessions', ['POST']],
  ['/revoke-other-sessions', ['POST']],
  ['/list-accounts', ['GET']],
  ['/callback/google', ['GET']],
  ['/callback/apple', ['GET', 'POST']],
  ['/passkey/generate-register-options', ['GET']],
  ['/passkey/generate-authenticate-options', ['GET']],
  ['/passkey/verify-registration', ['POST']],
  ['/passkey/verify-authentication', ['POST']],
  ['/passkey/list-user-passkeys', ['GET']],
  ['/passkey/update-passkey', ['POST']],
  ['/passkey/delete-passkey', ['POST']],
]);

export const identityRoutes = () => {
  const app = new Hono<Bindings>();
  app.use('*', async (c, next) => {
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  app.get('/auth/providers', (c) => {
    if (!c.env.AUTH_CONFIG_JSON)
      return c.json({ providers: [], configured: false, passkeys: false });
    const config = authConfig(c.env);
    return c.json({
      providers: ['google', 'apple'].filter((id) =>
        id === 'google' ? config.google : config.apple,
      ),
      configured: true,
      passkeys: true,
    });
  });
  app.get('/auth/me', async (c) => {
    const session = await requireSession(c.req.raw, createIdentity(c.env));
    copySessionHeaders(session.headers, c.res.headers);
    const binding = await existingOwner(c.env.ROUTES_DB, session.user.id);
    return c.json({
      user: session.user,
      ownerId: binding?.owner_id ?? null,
      session: { id: session.session.id, expiresAt: session.session.expiresAt },
    });
  });
  app.route('/', browserRoutes());
  app.get('/api/auth/error', (c) =>
    c.json(
      {
        error: {
          code: 'LOGIN_FAILED',
          message: 'Sign-in did not complete. Please try again.',
        },
      },
      400,
    ),
  );
  app.all('/api/auth/*', async (c) => {
    const path = c.req.path.slice('/api/auth'.length);
    if (!allowed.get(path)?.includes(c.req.method)) return c.notFound();
    const identity = createIdentity(c.env);
    let body: Uint8Array | string | undefined;
    if (!path.startsWith('/callback/'))
      checkCookieOrigin(c.req.raw, identity.config);
    if (
      [
        '/link-social',
        '/unlink-account',
        '/passkey/generate-register-options',
        '/passkey/verify-registration',
        '/passkey/delete-passkey',
        '/passkey/update-passkey',
      ].includes(path)
    )
      await requireSession(c.req.raw, identity, true);
    if (path === '/sign-in/social' || path === '/link-social') {
      const input = await readJsonBody(c, socialInput);
      if (!identity.config[input.provider])
        throw new AppError(
          503,
          'PROVIDER_NOT_CONFIGURED',
          'This login provider is not configured.',
        );
      body = JSON.stringify(input);
    } else if (c.req.raw.body) body = await readBoundedBody(c.req.raw, 64_000);
    const request = new Request(c.req.url, {
      method: c.req.method,
      headers: sessionHeaders(c.req.raw),
      body,
    });
    const response = await identity.auth.handler(request);
    if (path === '/passkey/generate-authenticate-options' && response.ok) {
      const options = (await response.json()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ ...options, userVerification: 'required' }),
        { status: response.status, headers: response.headers },
      );
    }
    return response;
  });
  return app;
};

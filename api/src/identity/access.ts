import { AppError } from '../errors.ts';
import type { Env } from '../types.ts';
import { type AuthConfig, createIdentity, type Identity } from './config.ts';

export const unauthorized = () =>
  new AppError(401, 'UNAUTHORIZED', 'A valid session is required.');

export const sessionHeaders = (request: Request) => {
  const headers = new Headers(request.headers);
  // An invalid explicit bearer token must never fall back to a browser cookie.
  if (headers.has('Authorization')) {
    // Keep ceremony cookies (OAuth/WebAuthn challenges), but never a fallback
    // session. Passkey registration can combine a bearer session and a challenge.
    const cookies = (headers.get('Cookie') ?? '')
      .split(';')
      .filter(
        (cookie) =>
          !/^(?:__Secure-)?ride-on\.(?:session_token|session_data|account_data)=/.test(
            cookie.trim(),
          ),
      )
      .join(';');
    if (cookies.trim()) headers.set('Cookie', cookies);
    else headers.delete('Cookie');
  }
  return headers;
};

export const checkCookieOrigin = (request: Request, config: AuthConfig) => {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
    request.headers.has('Authorization')
  )
    return;
  const origin = request.headers.get('Origin');
  if (!origin || ![config.baseUrl, ...config.trustedOrigins].includes(origin))
    throw new AppError(
      403,
      'INVALID_ORIGIN',
      'A trusted Origin is required for cookie-authenticated changes.',
    );
};

export const requireSession = async (
  request: Request,
  identity: Identity,
  fresh = false,
) => {
  if (!request.headers.has('Authorization') && !request.headers.has('Cookie'))
    throw unauthorized();
  checkCookieOrigin(request, identity.config);
  const result = await identity.auth.api.getSession({
    headers: sessionHeaders(request),
    returnHeaders: true,
  });
  if (!result.response) throw unauthorized();
  if (
    fresh &&
    Date.now() - result.response.session.createdAt.getTime() > 600_000
  )
    throw new AppError(
      403,
      'RECENT_LOGIN_REQUIRED',
      'Sign in again before changing account access.',
    );
  return { ...result.response, headers: result.headers };
};

export const existingOwner = (db: D1Database, userId: string) =>
  db
    .prepare('SELECT owner_id FROM auth_user_owners WHERE auth_user_id = ?')
    .bind(userId)
    .first<{ owner_id: string }>();

export const resolveAccess = async (request: Request, env: Env) => {
  const session = await requireSession(request, createIdentity(env));
  let binding = await existingOwner(env.ROUTES_DB, session.user.id);
  if (!binding) {
    await env.ROUTES_DB.prepare(
      'INSERT INTO auth_user_owners (auth_user_id, owner_id) VALUES (?, ?) ON CONFLICT (auth_user_id) DO NOTHING',
    )
      .bind(session.user.id, `user_${crypto.randomUUID()}`)
      .run();
    binding = await existingOwner(env.ROUTES_DB, session.user.id);
  }
  if (!binding) throw new Error('Owner binding was not persisted');
  return { ownerId: binding.owner_id, headers: session.headers };
};

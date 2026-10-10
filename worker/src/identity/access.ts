import { authenticate } from '../auth.ts';
import { AppError } from '../errors.ts';
import type { Env } from '../types.ts';
import { type AuthConfig, createIdentity, type Identity } from './config.ts';

export const unauthorized = () =>
  new AppError(401, 'UNAUTHORIZED', 'A valid session or API key is required.');

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
  // Preserve existing clients and permit migration even before social login is configured.
  try {
    return {
      ownerId: await authenticate(
        request.headers.get('Authorization') ?? undefined,
        env.API_KEYS_JSON,
      ),
      headers: new Headers(),
    };
  } catch (error) {
    if (!(error instanceof AppError) || ![401, 503].includes(error.status))
      throw error;
  }
  if (!env.AUTH_CONFIG_JSON) throw unauthorized();
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

export const claimOwner = async (
  db: D1Database,
  userId: string,
  ownerId: string,
) => {
  // Ownership is immutable: a concurrent first product request or another claim
  // wins atomically, rather than leaving routes stranded under an old owner.
  await db
    .prepare(
      'INSERT INTO auth_user_owners (auth_user_id, owner_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    )
    .bind(userId, ownerId)
    .run();
  const binding = await existingOwner(db, userId);
  if (binding?.owner_id !== ownerId)
    throw new AppError(
      409,
      'PROFILE_ALREADY_BOUND',
      'This login or profile already has an owner. Sign in with the linked account.',
    );
  return ownerId;
};

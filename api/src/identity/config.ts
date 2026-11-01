import { passkey } from '@better-auth/passkey';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins/bearer';
import {
  apple as appleProvider,
  google as googleProvider,
} from 'better-auth/social-providers';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import type { Env } from '../types.ts';

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});
const configSchema = z.strictObject({
  secret: z.string().min(32),
  baseUrl: httpsUrl.refine((value) => new URL(value).origin === value),
  trustedOrigins: z
    .array(httpsUrl.refine((value) => new URL(value).origin === value))
    .max(20)
    .default([]),
  // Exact destinations, including the path. No arbitrary extension redirects.
  clientRedirects: z
    .array(
      httpsUrl.refine(
        (value) => !new URL(value).search && !new URL(value).hash,
      ),
    )
    .max(20)
    .default([]),
  passkeyRpId: z
    .string()
    .regex(/^[a-z0-9.-]+$/)
    .optional(),
  google: z
    .strictObject({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
    .optional(),
  apple: z
    .strictObject({
      clientId: z.string().min(1),
      teamId: z.string().min(1),
      keyId: z.string().min(1),
      privateKey: z.string().min(1),
    })
    .optional(),
});
export type AuthConfig = z.infer<typeof configSchema>;

// Verify even server-exchanged ID tokens before Better Auth maps their profile.
const verifiedProfile =
  <T extends { idToken?: string }, R>(
    provider: 'google' | 'apple',
    clientId: string,
    readProfile: (token: T) => Promise<R>,
  ) =>
  async (token: T): Promise<R | null> => {
    if (!token.idToken) return null;
    try {
      const { payload } = await jwtVerify(
        token.idToken,
        createRemoteJWKSet(
          new URL(
            provider === 'google'
              ? 'https://www.googleapis.com/oauth2/v3/certs'
              : 'https://appleid.apple.com/auth/keys',
          ),
        ),
        {
          algorithms: ['RS256'],
          audience: clientId,
          maxTokenAge: '1h',
          issuer:
            provider === 'google'
              ? ['https://accounts.google.com', 'accounts.google.com']
              : 'https://appleid.apple.com',
          requiredClaims: ['sub', 'exp', 'iat'],
        },
      );
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof payload.email !== 'string'
      )
        return null;
      return readProfile(token);
    } catch {
      return null;
    }
  };

export const authConfig = (env: Pick<Env, 'AUTH_CONFIG_JSON'>): AuthConfig => {
  try {
    return configSchema.parse(JSON.parse(env.AUTH_CONFIG_JSON));
  } catch {
    throw new AppError(
      503,
      'LOGIN_NOT_CONFIGURED',
      'Social login is not configured.',
    );
  }
};

export const authOptions = (config: AuthConfig): BetterAuthOptions => ({
  appName: 'Ride On',
  baseURL: config.baseUrl,
  basePath: '/api/auth',
  secret: config.secret,
  trustedOrigins: [
    config.baseUrl,
    ...config.trustedOrigins,
    'https://appleid.apple.com',
  ],
  logger: { disabled: true },
  user: { modelName: 'auth_user' },
  session: {
    modelName: 'auth_session',
    expiresIn: 7 * 86400,
    updateAge: 86400,
    freshAge: 600,
    cookieCache: { enabled: false },
  },
  account: {
    modelName: 'auth_account',
    encryptOAuthTokens: true,
    storeStateStrategy: 'database',
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: true,
      allowUnlinkingAll: false,
    },
  },
  verification: { modelName: 'auth_verification' },
  rateLimit: {
    enabled: true,
    storage: 'database',
    modelName: 'auth_rate_limit',
    window: 60,
    max: 60,
  },
  advanced: {
    database: { generateId: 'uuid' },
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    useSecureCookies: true,
    cookiePrefix: 'ride-on',
    // Apple posts its callback cross-site; the signed state cookie must survive.
    cookies: { state: { attributes: { sameSite: 'none', secure: true } } },
  },
  socialProviders: {
    ...(config.google
      ? {
          google: {
            ...config.google,
            getUserInfo: verifiedProfile(
              'google',
              config.google.clientId,
              googleProvider(config.google).getUserInfo,
            ),
          },
        }
      : {}),
    ...(config.apple
      ? {
          apple: async () => {
            const apple = config.apple;
            if (!apple) throw new Error('Apple is not configured');
            const clientSecret = await new SignJWT({})
              .setProtectedHeader({ alg: 'ES256', kid: apple.keyId })
              .setIssuer(apple.teamId)
              .setSubject(apple.clientId)
              .setAudience('https://appleid.apple.com')
              .setIssuedAt()
              .setExpirationTime('1h')
              .sign(await importPKCS8(apple.privateKey, 'ES256'));
            return {
              clientId: apple.clientId,
              clientSecret,
              getUserInfo: verifiedProfile(
                'apple',
                apple.clientId,
                appleProvider({ clientId: apple.clientId, clientSecret })
                  .getUserInfo,
              ),
            };
          },
        }
      : {}),
  },
  plugins: [
    bearer(),
    passkey({
      rpID: config.passkeyRpId ?? new URL(config.baseUrl).hostname,
      rpName: 'Ride On',
      origin: [config.baseUrl, ...config.trustedOrigins],
      schema: { passkey: { modelName: 'auth_passkey' } },
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      registration: {
        requireSession: true,
        afterVerification: async ({ verification }) => {
          if (!verification.registrationInfo?.userVerified)
            throw new APIError('BAD_REQUEST', {
              code: 'USER_VERIFICATION_REQUIRED',
              message: 'Verify with your device PIN or biometrics.',
            });
        },
      },
      authentication: {
        afterVerification: async ({ verification }) => {
          if (!verification.authenticationInfo.userVerified)
            throw new APIError('BAD_REQUEST', {
              code: 'USER_VERIFICATION_REQUIRED',
              message: 'Verify with your device PIN or biometrics.',
            });
        },
      },
    }),
  ],
});

export const createIdentity = (env: Env) => {
  const config = authConfig(env);
  return {
    config,
    auth: betterAuth({ ...authOptions(config), database: env.ROUTES_DB }),
  };
};
export type Identity = ReturnType<typeof createIdentity>;

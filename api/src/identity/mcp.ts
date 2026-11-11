import { type McpOptions, mcp } from '@better-auth/mcp';
import { getOAuthProviderApi } from '@better-auth/oauth-provider';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import {
  createDpopReplayStore,
  enforceDpopBinding,
  parseAccessTokenAuthorization,
} from 'better-auth/oauth2';
import { z } from 'zod';

export const agentScopes = [
  'preferences:read',
  'routes:read',
  'routes:write',
  'rides:score',
] as const;
export const scopeDescriptions: Record<string, string> = {
  'preferences:read': 'Read your personal riding preferences',
  'routes:read': 'Read your saved route library',
  'routes:write': 'Add routes to your library',
  'rides:score': 'Score routes using your preferences and the forecast',
  offline_access: 'Stay connected until you revoke access',
};

export const agentAuthPlugins = (baseUrl: string) => {
  const resource = `${baseUrl}/mcp`;
  const options: McpOptions = {
    resource,
    loginPage: '/auth/agents/sign-in',
    consentPage: '/auth/agents/consent',
    scopes: [...agentScopes, 'offline_access'],
    grantTypes: ['authorization_code', 'refresh_token'],
    // Opaque tokens are checked against D1 on every call, including revocation.
    disableJwtPlugin: true,
    storeTokens: 'hashed',
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresIn: 30 * 86400,
    refreshTokenReuseInterval: 0,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultApplicationType: 'infer',
    clientRegistrationDefaultScopes: [...agentScopes, 'offline_access'],
    rateLimit: { register: { window: 60, max: 10 } },
  };
  const provider = mcp(options);
  return [
    provider,
    {
      id: 'ride-on-agent-access',
      endpoints: {
        // Server API only: identityRoutes deliberately never exposes this path.
        checkMcpAccess: createAuthEndpoint(
          '/internal/mcp-access',
          {
            method: 'POST',
            metadata: { SERVER_ONLY: true },
            body: z.object({
              authorization: z.string(),
              proof: z.string().optional(),
              method: z.string(),
            }),
          },
          async (ctx) => {
            const authorization = parseAccessTokenAuthorization(
              ctx.body.authorization,
            );
            if (!authorization) throw new APIError('UNAUTHORIZED');
            const claims = await getOAuthProviderApi(
              ctx,
              provider.options,
            ).requireActiveAccessToken(authorization.token);
            const audiences = Array.isArray(claims.aud)
              ? claims.aud
              : [claims.aud];
            if (
              typeof claims.sub !== 'string' ||
              typeof claims.client_id !== 'string' ||
              !audiences.includes(resource) ||
              claims.iss !== `${baseUrl}/api/auth`
            )
              throw new APIError('UNAUTHORIZED');
            await enforceDpopBinding({
              payload: claims,
              authorization,
              proofJwt: ctx.body.proof,
              method: ctx.body.method,
              url: resource,
              replayStore: createDpopReplayStore(ctx.context.internalAdapter),
            });
            const consent = await ctx.context.adapter.findOne<{
              scopes: string[];
            }>({
              model: 'oauthConsent',
              where: [
                { field: 'userId', value: claims.sub },
                { field: 'clientId', value: claims.client_id },
              ],
            });
            if (!consent) throw new APIError('UNAUTHORIZED');
            const scopes =
              typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
            return {
              userId: claims.sub,
              clientId: claims.client_id,
              scopes: scopes.filter((scope) => consent.scopes.includes(scope)),
            };
          },
        ),
      },
    },
  ];
};

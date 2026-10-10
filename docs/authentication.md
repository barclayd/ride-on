# Ride On authentication

The v0.6 API uses Better Auth 1.7.7 on Cloudflare Workers with native D1 storage.
Apple, Google and passkeys share one login identity, which maps to one cycling
profile. Product APIs accept authenticated sessions only. Weather scoring, saved preferences, imports and route ownership use the same contracts.

The canonical API domain is `https://api.ride-on.cc`. Apple and Google are configured
in production. Apple sign-in and the existing profile binding were verified end to
end on 10 October 2026. Google authorization startup is verified; a full Google
login and a physical-device passkey ceremony remain to be checked. The automated
suite uses synthetic credentials and signed provider/WebAuthn responses.

## Provider setup

Register a **Google Web application** OAuth client. Its authorized redirect URI is:

```
https://api.ride-on.cc/api/auth/callback/google
```

Configure the consent screen and test users while the Google app is in testing.
Only OpenID/email/profile scopes are requested. Add actual Ride On frontend
origins if using Google's client tooling; Cycle.travel is not a login origin.

For **Sign in with Apple**, enable the capability on the primary App ID, create a
Services ID for web sign-in, associate it with that App ID, and register
`api.ride-on.cc` with this return URL:

```
https://api.ride-on.cc/api/auth/callback/apple
```

Create a Sign in with Apple signing key. Supply the Services ID as `clientId`,
Apple Team ID, key ID and `.p8` private key. The API generates a one-hour ES256
client-secret JWT when needed, so a manually generated six-month secret does not
need periodic replacement. Apple sends a cross-site form POST; the signed OAuth
state cookie uses `SameSite=None; Secure`. Session cookies remain host-only,
`HttpOnly; Secure; SameSite=Lax`.

Apple/Google login to Ride On does **not** authorize Garmin, Strava or Cycle.travel
route access. Route-source connections remain a separate concern.

## Secret configuration

`AUTH_CONFIG_JSON` is one Worker secret. Keep its local source in ignored
`worker/.auth-config.json` with owner-only file permissions, and never commit it.
A configuration has this shape (the placeholders below are not usable secrets):

```json
{
  "secret": "a-stable-cryptographically-random-secret-of-at-least-32-characters",
  "baseUrl": "https://api.ride-on.cc",
  "trustedOrigins": ["https://ride-on.cc", "https://www.ride-on.cc"],
  "clientRedirects": [],
  "passkeyRpId": "ride-on.cc",
  "google": { "clientId": "google-web-client-id", "clientSecret": "google-client-secret" },
  "apple": {
    "clientId": "apple-services-id",
    "teamId": "apple-team-id",
    "keyId": "apple-key-id",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  }
}
```

Omit either provider until its credentials exist. Keep `secret` stable when adding
providers: it signs sessions and encrypts provider access/refresh tokens. Account
ID tokens are stored by Better Auth in D1; they are never returned by product APIs.
Keep database access restricted. The API does not expose provider-token endpoints.

From `worker/`, after preparing the file securely:

```sh
bunx wrangler secret put AUTH_CONFIG_JSON < .auth-config.json
bun run migrate:remote
bun run deploy
```

For local social login, use an HTTPS development hostname registered separately
with the providers, matching `baseUrl`, origins and its passkey RP ID. Set the
JSON as a single quoted value of `AUTH_CONFIG_JSON` in ignored `.dev.vars`.
For local bearer-session development, run `bun run migrate:local` followed by
`bun run dev:session` before `bun run dev`. This creates a separate localhost auth
configuration and a 24-hour session in local D1, saving the token in ignored,
owner-readable `.local-session.json`. It never connects to production. An optional
local owner ID selects an existing local dataset; it is not a production login or
profile migration. Keep production credentials out of this local configuration.
Unit/integration tests need neither a domain nor real keys. Deploy migrations
before the new Worker;
`0004_identity.sql` adds auth tables without rewriting profiles or routes.

## Sessions and profiles

`GET /auth/providers` is public and returns available social providers plus
`configured` and `passkeys` booleans. A missing provider produces
`503 PROVIDER_NOT_CONFIGURED`; no fallback provider is selected.

`GET /auth/me` requires a session and returns the login user, a nullable `ownerId`
and session ID/expiry. It does not provision a cycling profile or assign an owner.
Use `POST /users` after sign-in to create a new rider's profile; its saved settings
API stays unchanged. First access to a product endpoint binds a new, server-generated
owner ID to the login. Clients cannot supply an owner ID.

**The existing profile migration is complete.** Dan's Apple identity is already
bound to owner `dan`; its preferences and data remain under that same owner ID.
Signing in with the same Apple account automatically uses that binding. Clients
must not implement a claim step, hardcode `dan`, or embed an old private API key.

The legacy private-key authentication path and `POST /auth/claim-profile` were
removed in v0.6.0. Old API keys return `401`; the removed endpoint returns `404`.
The `auth_user_owners` table and all existing rows are retained. New users receive
their own owner automatically on first product access, then use `POST /users` to
create their settings. An unlinked Google account is a separate identity; use
explicit account linking from the existing Apple login to share its profile.

Sessions last seven days and refresh after one day of use. API calls return any
refreshed session cookie and `set-auth-token` header; bearer clients should persist
that header when present. Product endpoints accept session bearer tokens or
cookies. Explicit invalid bearer credentials never fall back to browser session
cookies. Logout/revocation checks D1 on the next request; cookie
session caching is disabled. No separate JWT/refresh-token system is introduced.

Cookie-authenticated writes require an exact trusted `Origin`. Browser fetches
must include credentials. CORS only permits configured frontend origins with
credentials; there are no wildcard origins. Prefer calls from the extension's
background service worker with host permissions and bearer auth, rather than
exposing tokens to Cycle.travel's page or a content script.

## Social login and linked accounts

Same-site web clients start with:

```http
POST /api/auth/sign-in/social
Origin: https://ride-on.cc
Content-Type: application/json

{"provider":"google","callbackURL":"https://ride-on.cc/signed-in","disableRedirect":true}
```

Preserve the state cookie, navigate to the returned `url`, and let the provider
return through its callback. The successful callback sets the session cookie.
Use `provider: "apple"` for Apple. Callback destinations must be trusted. Direct
client-supplied provider ID-token login is intentionally excluded in this release;
use the browser code flow. Google uses PKCE; ID tokens from both providers are
verified against their public keys, issuer, audience and expiry before mapping an
identity. OAuth state is bound to the initiating browser.

To add Apple to an existing Google account (or vice versa), sign in first and use
`POST /api/auth/link-social` with the same social-login body. Linking and unlinking
require a login within ten minutes. Private relay addresses may differ because
both accounts are explicitly proven. Email matches never silently link accounts.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/get-session` | Current Better Auth session and user, or `null` |
| `POST /api/auth/sign-out` | Revoke current session; body `{}` |
| `GET /api/auth/list-sessions` | List your active sessions |
| `POST /api/auth/revoke-session` | Revoke your session by its `token` |
| `POST /api/auth/revoke-other-sessions` | Keep this session; revoke the rest |
| `POST /api/auth/revoke-sessions` | Revoke all your sessions |
| `GET /api/auth/list-accounts` | List your linked login providers |
| `POST /api/auth/unlink-account` | Remove a provider using `providerId` |

The last social provider cannot be removed, retaining a recovery route if a
passkey is lost. There is no password, email-reset or administrator account-recovery
flow in this release. Better Auth endpoints return its native `{code,message}`
errors; Ride On endpoints use `{error:{code,message}}`. OAuth failures redirect to
an error callback or the sanitized `/api/auth/error` response.

## Chrome extension / browser handoff

Register the extension's exact HTTPS redirect URL in `clientRedirects`, for
example the result of `chrome.identity.getRedirectURL('ride-on')`. Development and
published extensions have separate IDs; register each explicitly. No wildcard
`chromiumapp.org` redirect is accepted. The frontend implementation is separate.

1. Generate a random PKCE verifier (43–128 URL-safe characters) and independent
   random `state` (16–256 URL-safe characters). Compute base64url(SHA-256(verifier)),
   without padding.
2. `POST /auth/browser/start` with `provider`, `redirectUri`, `codeChallenge` and
   `state`. Open the returned `authorizationUrl` using `launchWebAuthFlow`. This
   first-party navigation establishes the browser cookies without relying on
   third-party extension cookie access.
3. After login, the exact registered redirect receives `code` and `state`.
   Compare state to the original value. Session credentials never appear in URLs.
4. `POST /auth/browser/exchange` with `code`, `codeVerifier` and the same
   `redirectUri`. Store the returned `token`, `tokenType` and `expiresAt` securely.
   Use `Authorization: Bearer <token>` with product APIs.

The initial flow lasts ten minutes. The final code lasts sixty seconds, is stored
hashed, and is consumed atomically only when PKCE and redirect both match. A
revoked/expired session cannot be exchanged. A session that predates this browser
flow cannot complete it. Public handoff endpoints have persistent per-IP rate
limits. Failed or cancelled OAuth should let the client cancel and restart the
flow; there is no background provider retry.

## Passkeys

First sign in with Apple or Google, then register a passkey for that same account.
The RP ID is `ride-on.cc` in production. Only explicitly configured Ride On origins
are accepted. Choose that RP ID before enrollment; changing it requires registering
new passkeys. Passkeys cannot be enrolled or used from `cycle.travel` itself.

Use Better Auth's `@better-auth/passkey/client` on a Ride On HTTPS page, or perform
the WebAuthn ceremonies against the following endpoints. All paths start with
`/api/auth/passkey`:

| Method/path | Contract |
| --- | --- |
| `GET /generate-register-options` | Recent session; returns creation options and challenge cookie |
| `POST /verify-registration` | `{ "response": <RegistrationResponseJSON>, "name": "My phone" }` with the same session and challenge cookie |
| `GET /generate-authenticate-options` | Public; returns request options and challenge cookie |
| `POST /verify-authentication` | `{ "response": <AuthenticationResponseJSON> }` with that challenge cookie; returns session and user |
| `GET /list-user-passkeys` | Session; lists only your credentials |
| `POST /update-passkey` | Recent session; `{ "id": "...", "name": "..." }` |
| `POST /delete-passkey` | Recent session; `{ "id": "..." }` |

Registration requires a discoverable credential. Device PIN/biometric user
verification is required and checked server-side for both ceremonies. Challenges
expire after five minutes and are consumed once. Origins, RP ID, signatures and
nonzero authenticator counters are verified by SimpleWebAuthn. Only public keys
are stored; biometrics/private keys stay with the authenticator.

This release supplies the passkey API. A Ride On login page is still needed for
web/extension passkey prompts, and native associated-domain setup is separate.
The extension's ready-made browser handoff currently selects Apple or Google.

## Verification

The MSW 3 suite runs real Better Auth, D1, WebAuthn verification and the production
Worker in Miniflare. Synthetic providers enforce token-exchange PKCE and validate
Apple's signed client secret. Tests cover invalid provider signatures/audiences,
state, replay, private email linking, preservation of existing owner bindings,
retired-key rejection, concurrent owner creation and code redemption,
CSRF, isolation, immediate logout/revocation and provider outages. Synthetic ES256
authenticators exercise actual registration and sign-in, malicious origins/RP IDs,
missing user verification, bad signatures, expiry, counters and challenge replay.
No live credentials or network fallback are used.

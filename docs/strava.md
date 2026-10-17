# Shared Strava connection

Implemented locally on 17 October 2026; **disabled until the coordinated rollout below**.
This first release connects a Ride On account and displays its completed cycling
activities. Route imports, automatic ride logging/matching and speed suggestions
are deferred. Strava history does not enter recommendation scoring or learning.

## Shared application

Ride On and Stitch use Strava application **262735**. Its Authorization Callback
Domain remains **stravastitch.com**. Stitch owns the client secret, encrypted
access/refresh tokens, per-athlete refresh coordination and the existing webhook
subscription. No Strava secret or token is copied into Ride On or the native app.

The Ride On Worker calls Stitch's named `RideOnStrava` entrypoint through the
private `STRAVA_STITCH` service binding. The ordinary Stitch website exposes no
connection lookup, token exchange or history endpoint. Both Workers must belong
to the same Cloudflare account. This deliberately couples availability and quota
to the shared service.

Consent requests Stitch's existing scopes: `read`, `activity:read`,
`activity:read_all` and `activity:write`. Ride On uses activity reads only. The
app explains that the shared connection also supports Stitch uploads. Riders can
withhold private-activity access; the API then reports `privateActivities: false`.
Missing all activity-read permission prevents connection. Revoking permissions
can affect both products because this is one Strava authorization.

## Client API

All `/connections/strava` endpoints require the signed-in Ride On owner, using
the existing bearer session or browser session. Responses use `Cache-Control:
no-store`; no credentials, private grant identifier or raw provider errors are
returned. Strava failures never cause a Ride On sign-out.

| Method and path | Result |
| --- | --- |
| `GET /connections/strava` | `{configured, connection}`; connection is null or `{status, athleteId, connectedAt, privateActivities}`. Status is `connected` or `needs-reauthorisation`. |
| `POST /connections/strava/start` | Accepts `{state, codeChallenge}`; returns 201 `{requestId, authorizationUrl, expiresIn: 600}`. Starting again invalidates the owner's previous attempt. |
| `POST /connections/strava/complete` | Accepts `{requestId, codeVerifier}`; returns `{connected: true}`. Requires the originating owner and verifier; the handoff can succeed once. |
| `GET /connections/strava/rides?page=1` | Returns `{rides, page, nextPage, fetchedAt}`. |
| `DELETE /connections/strava` | Deletes Ride On's mapping and pending attempts; returns `{disconnected: true, message}`. Stitch stays connected. |

The native client generates a random verifier (43–128 URL-safe characters) and
state (16–128 URL-safe characters). `codeChallenge` is unpadded base64url SHA-256
of the verifier. The challenge protects the Ride On handoff; Strava's own code
exchange remains server-side.

Open `authorizationUrl` in `ASWebAuthenticationSession`, supplying the Ride On
bearer session via `additionalHeaderFields` **on that initial request only**.
Validate its HTTPS origin/path before attaching the header. The browser endpoint
also requires the originating owner, so forwarding the URL to another person
does not link their Strava account. Web clients instead use their Ride On session
cookie. A native caller cannot start this flow by opening an unauthenticated URL
in an ordinary browser.

The browser receives a Secure, HttpOnly, SameSite=Lax cookie before Strava consent.
Strava redirects to `https://stravastitch.com/auth/ride-on/callback`; Stitch relays
only `state`, `code`, `scope` and `error` to a fixed Ride On endpoint. Ride On
checks the cookie/state, claims the attempt once, exchanges through the private
binding and redirects to:

```
https://api.ride-on.cc/integrations/strava/done?state=<client-state>&result=ready
```

The app validates the exact HTTPS host/path, unique state and `result=ready`,
then completes the handoff within 60 seconds. Other outcomes are `cancelled` and
`failed`; neither carries an upstream error or authorization code. Existing
Ride On associated-domain configuration handles the HTTPS authentication callback.

## Completed rides

Each entry contains `id`, `name`, `sportType`, `startedAt`, `distanceKm`,
`movingSeconds`, `elapsedSeconds`, `elevationGainM` and a `url` linking to the
activity on Strava. IDs are decimal strings; dates are UTC ISO 8601. Cycling types
are Ride, MountainBikeRide, GravelRide, VirtualRide, EBikeRide, EMountainBikeRide,
Handcycle and Velomobile. No GPS, heart rate, photos or other athletes' data are
returned.

Pages follow Strava's 30-activity pages before filtering. A page containing only
non-cycling activities can have `rides: []` and a non-null `nextPage`; clients
must still offer Load More. A full final page may require one additional request
to discover the end. `fetchedAt` describes this live read, not a background sync.

History is not persisted in D1, SwiftData or an app cache. The Preferences screen
clears its in-memory history when left or backgrounded, and reloads on return.
Deleted/edited Strava activities are reflected on the next read. Durable storage
contains only the connection mapping, scopes, timestamps, short-lived connection
attempts and bounded rate-limit counters. Disconnect clears the mapping and
attempts. Scheduled cleanup expires flow/rate-limit rows.

One Strava athlete can belong to one Ride On owner. A stable private grant ID is
stored with Stitch's encrypted account and retained across token refresh. When
Stitch forgets the account (including verified Strava revocation), a later
connection gets a new grant ID: an old Ride On mapping cannot silently regain
access. A slow history request also rechecks both this grant and Ride On's local
connection generation before returning data.

Provider errors use the normal API envelope: 409 requires reconnection, 403
requires activity permission, 429 includes `Retry-After`, 502 means the provider
is unavailable and 503 means the integration is disabled. Local start attempts
are limited to five per owner per minute; history and handoff endpoints also have
bounded request rates. The shared Strava application's limits apply to both apps.

## Coordinated rollout

1. Review the changes in both `ride-on` and `strava-stitch`. Run Ride On's
   `bun run check` and `bun run build:check`, and Stitch's `npm test`,
   `npm run typecheck`, `npm run format` and `npm run build`.
2. Deploy Stitch's **production environment** first. It adds the named
   `RideOnStrava` entrypoint and fixed callback relay without changing its
   existing sign-in callback, secrets, webhook registration or stored accounts.
3. Apply Ride On's pending D1 migrations, including `0012_strava.sql`, then
   deploy Ride On with its `STRAVA_STITCH` binding targeting the production
   `strava-stitch` Worker and `entrypoint: RideOnStrava`. Keep the feature flag
   false until both sides are in place. The repositories' normal main-branch
   deployment workflows can perform these steps in the same order.
4. Set `STRAVA_ENABLED` to the string `"true"` and deploy Ride On. Build/install
   the updated native app. No new client secret or Strava callback-domain change
   is needed.
5. On a real signed-in device, connect through Preferences → Strava, inspect
   completed rides and paging, then disconnect/reconnect. Check that Stitch can
   still open its existing activities. Real OAuth/provider access is the remaining
   production acceptance check; automated tests use synthetic accounts only.

Rollback by setting `STRAVA_ENABLED` to `"false"`. Leave the migration and private
entrypoint deployed while a binding still references it. Ride On disconnect
remains available to API callers even while disabled. Local tests run with an
injected synthetic binding; the fixed production relay deliberately cannot be
redirected to arbitrary localhost or preview URLs.

## References

- [Strava authentication and scopes](https://developers.strava.com/docs/authentication/)
- [Strava activities API](https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities)
- [Strava webhooks](https://developers.strava.com/docs/webhooks/)
- [Strava API policy](https://www.strava.com/legal/api_policy)
- [Apple initial authentication request headers](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/additionalheaderfields)

Any later durable imports, derived speed defaults or training/learning use need
their own product and retention design against the current Strava terms. This
release keeps provider history separate from Ride On's manually logged rides.

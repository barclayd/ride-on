# Workers integration tests with MSW 3

Run `bun run test:integration` from `worker/` with Node.js 24+. `bun run check`
includes this suite after the Bun unit tests. CI pins Node 24 and Bun 1.4.0.

The tests exercise the public API in an actual `workerd` isolate via Miniflare,
with a fresh D1 database and KV namespace per test. SQL comes from the real
migration files, split with Wrangler's SQL parser and applied as D1 statements.
Worker restarts retain those bindings, testing storage independently of JS memory.

The test entry point calls the production application factory, overriding only
the clock and request logging. The real session authentication, GPX parser, route store,
Met Office HTTP adapter, source selection, cache and recommendation engine run.
MSW 3.0.2 `http` handlers receive the actual outbound requests and return realistic
Global Spot and BPF v2 CoverageJSON payloads. This covers serialization and provider normalization instead
of replacing a provider with already-normalized weather.

Miniflare's `outboundService` resolves requests with MSW's documented `getResponse`
API. `setupServer` only intercepts requests in its own JS process, so it cannot
intercept an isolated Worker's fetch directly. The outbound bridge provides that
boundary without a mock HTTP server, global fetch patch or production test flag.
No handler means a recorded failure and an immediate blocked response. Normal
teardown rejects both unhandled requests and resolver exceptions, including those
that application error handling catches. The guard has its own regression test.

Use Node for this suite: Miniflare's Undici dispatcher/restart implementation is
not fully compatible with Bun's Undici shim. Bun still runs the existing fast unit
tests. Miniflare and esbuild are pinned to Wrangler's own versions to avoid a
second runtime version; update them together when upgrading Wrangler.

Product scenarios seed expiring users/sessions and owner bindings into local D1;
there is no private-key bypass. Authentication scenarios start with empty identity
tables and use ephemeral RSA provider keys and an ES256 Apple client
key. MSW receives real token-exchange bodies and verifies PKCE and Apple client JWTs.
Passkey tests construct CBOR attestations and signed ES256 WebAuthn assertions;
SimpleWebAuthn performs the actual verification in workerd. The OAuth/session clock
is real time; only weather/recommendation time is fixed.

Covered scenarios include:

- WeatherKit JWT signatures in the real Worker, new-user Apple defaults, preserved Met Office profiles and selectable provider presets.
- Apple hourly periods, route-relative wind, missing evidence, strict versus explicit fallback, no redirect credential forwarding, cache expiry and retained attribution.
- Google and Apple callbacks, private relay, explicit linking and encrypted provider credentials.
- Session persistence, immediate revocation, expiry, CSRF and invalid bearer/cookie precedence.
- Preservation of existing owner bindings, retired-key/claim rejection, concurrent first access, exact redirect allowlists and one-use PKCE handoff.
- Real passkey enrollment/login/rename/removal, identity binding and recent-session checks.
- Signature, origin, RP ID, challenge, counter, user verification, expiry and replay rejection.

- Upload, migration-backed persistence, restart, daylight and pace defaults.
- Cycle.travel/Garmin/Strava GPX import identities, large string IDs, repeat/concurrent imports and atomic refresh conflicts.
- Owner-scoped source lookup, route detail, stable library pagination and legacy upload compatibility.
- Durable explicit shortlists, deselection, empty lists, ownership and optimistic version conflicts.
- Imported geometry changes reaching the weather/scoring pipeline; only chosen rides fetching weather.
- Import body bounds, malformed GPX, rejected URL-fetch attempts and unchanged storage after failures.
- User creation, owner isolation, profile persistence, duplicate/concurrent writes and version conflicts.
- Saved settings versus temporary nested overrides, explicit limit removal and validation after merging.
- Climbing preferences persisted through user endpoints, temporary overrides, neutral backfill for old profiles, weather-cache reuse and minimum-condition precedence.
- Complete versus partial GPX elevation, known zero ascent and no weather calls for routes unassessable under an active climbing preference.
- Preferred distance persisted per owner and across restarts, temporary range replacement, explicit null clearing, omitted-field preservation and old-profile defaults.
- Shorter/flatter combined ranking, weather and minimum-condition precedence, visible out-of-range alternatives, cache reuse and invalid ranges rejected before writes or weather calls.
- Whole-ride windows, time zones, DST rejection and no weather calls for routes that cannot fit.
- Preference changes and speed overrides reusing cached forecasts.
- Hourly departure selection and route-relative wind direction.
- BPF percentile/mean selection, total cloud, native precipitation intervals and site reuse.
- Sunshine through cloud, unknown weather symbols, personal sunshine/warmth ranking reversals.
- Explicit retrieval-only freshness, missing-cloud exclusion and BPF quota recovery.
- Minimum-standard failures with evidence, unresolved monthly limits and fallbacks.
- Missing fields at later route locations and partial forecast horizons.
- Upstream auth, quota and service errors; recovery; no credential leaks or redirects.
- Invalid JSON, wrong units, distant forecast locations and stale model runs.
- KV corruption, retrieval freshness and persistence across a Worker restart.
- Authentication, owner isolation, malformed/oversized input and multipart imports.
- No weather calls for impossible dates, unknown providers or rejected requests.

Assertions focus on observable decisions and contract invariants. Avoid snapshots
of whole responses, sleeps to wait for readiness, or importing scoring functions to
calculate expected rankings. Each test owns its handlers and storage. Fixtures are
synthetic, the clock is fixed, and credentials are test-only constants.

This suite tests local runtime behavior, not Cloudflare's distributed KV propagation,
production latency, real Met Office availability, or forecast accuracy. Unit tests
cover transport cancellation/timeouts and the remaining scalar/interval edge cases.

The wind calibration scenario changes only personal crosswind sensitivity, reverses
the sunshine-versus-crosswind ordering, preserves the helpful-tailwind winner and
reuses KV after a Worker restart. Out-of-range sensitivity fails before weather I/O.

## Multi-day planning

`planning.test.ts` exercises the real Worker against MSW 3 WeatherKit fixtures:
server-owned multi-day selection, optional previews, horizon reuse after restart,
actual coverage/cutoffs/gaps, provider failure states, expired dates, functional
rain/sunshine presets, optimistic saved planning/units and weather-only diagnostics.
`node scripts/benchmark-planning.ts` from `worker/` is an explicit local benchmark;
it uses synthetic routes and never calls a live provider.

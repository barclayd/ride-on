# ride-on-api (Cloudflare Worker)

API-first ride recommender: GPX ingestion, durable route facts, modular weather
providers and deterministic route/departure ranking. The legacy `/classify` and
`/strava/*` endpoints have been removed with Dan's authorization. Existing clients
remain separate; adapt them after the API algorithm has been calibrated.

Read `../docs/api.md` for contracts, defaults, setup, validation and limitations.
Read `../docs/strava.md` for the shared Stitch connection and coordinated rollout. Keep Strava credentials in Stitch and do not revive the legacy token proxy.
Read `../docs/ride-history.md` for ride logging, geometry enrichment and repetition scoring.
Read `../docs/planning-api.md` for multi-day searches, presets and coverage.
Read `../docs/extension-api-brief-v3.md` for planned snapshots, next-window suggestions and route-history summaries.
Read `../docs/extension-api-brief-v4.md` for condition-chip summaries and saved display units (implemented in v0.15.0).
Read `../docs/ground-assessment-api.md` and `../docs/ground-calibration.md` for the opt-in, uncalibrated wetness model. Do not enable score penalties before calibration.
Read `../docs/ground-evidence-api.md` for the opt-in ground evidence diagnostic and non-commercial prototype limits. It does not affect scoring.
Read `../docs/weather-providers.md` for verified weather mappings and provider rules.
Read `../docs/weather-provider-choices.md` for the public Apple Weather / Met Office choice; product IDs remain internal presets and legacy API inputs.

## Conventions

- Functional TypeScript: functions, consts and types. No classes except the
  existing `AppError extends Error` for HTTP error mapping.
- Validate request JSON with Zod; reject unknown preference fields. Parse GPX
  strictly with bounded input and no DTDs. Parameterize all D1 SQL.
- Weather adapters validate required envelopes, units and selected values while
  tolerating unrelated upstream fields. Missing weather stays missing.
- Providers, caches, stored route facts and deterministic evaluation are separate.
  No provider payloads or credentials in the engine. Keep scoring versioned and
  preference-driven; tests must not bake Dan's personal thresholds into defaults.
- Never log tokens, GPX bodies, forecast bodies or auth headers. Request logging
  is method/path/status/duration only. Secrets belong in ignored `.dev.vars` or
  Cloudflare Worker secrets, not source or reports.
- Tests use synthetic weather; live quota-consuming diagnostics are explicit.

## Commands

```sh
bun install --frozen-lockfile
bun run migrate:local   # initialize/update local D1
bun run dev:session     # create a 24-hour local D1 session (never production)
bun run dev             # local Workers runtime
bun run check           # types + lint + unit + MSW 3 Workers integration tests
bun run test:unit       # Bun unit tests
bun run test:integration # Node 24+; real Workers/D1/KV, mocked HTTP boundary
bun run build:check     # bundle only; no deployment
bun run bindings        # regenerate Env after wrangler.jsonc changes
bun run lint:fix
```

## Structure

- `src/strava/`: owner-bound handoff, live cycling history and date-only activity history and temporary matching evidence through Stitch’s private named service binding. Grouped `/history` APIs, D1 import/push outboxes and the shared monitoring queue are documented in `../docs/strava.md`. Dan chose date-only retention and confirmation for uncertain matches: clear 90%+ matches log automatically, while 50–89%, ambiguous, mixed-direction and incomplete matches remain suggestions until confirmed; preserve source deletion, disconnect cleanup, and seven-day evidence expiry.

- `src/index.ts`: Hono routes and dependency composition; `createApp` accepts test dependencies.
- `src/identity/`: Better Auth Google/Apple/passkeys, session-only access, stable owner bindings and PKCE browser handoff. See `../docs/authentication.md`.
- `src/body.ts`, `request.ts`, `errors.ts`: bounded input and errors.
- `src/routes/`: GPX normalization, replaceable source adapters, versioned source imports, paginated owner-scoped D1 persistence and saved shortlists. Imports never select rides; recommendations always take explicit route IDs.
- `src/rides/`: owner-scoped history, immutable geometry, idempotent logging and bounded overlap assessment.
- `src/recommendations/`: strict preference resolution, daylight/time-window planning and pure scoring.
- `src/users/`: owner-bound saved settings, schema versions and atomic optimistic updates.
- `src/ground/`: independent, experimental rainfall/drying evidence, shared D1 cache and bounded public-provider diagnostics; never invoked by recommendations.
- `src/weather/`: generic contracts, Apple Weather and Met Office adapters, provider presets, source policy and KV-compatible cache.
- `src/monitoring/`: scheduled tracked-ride checks, alert policy, owner-scoped device registration and durable APNs delivery. See `../docs/ride-monitoring.md`; app notification integration follows separately.
- `migrations/`: D1 migrations, applied before deployment.
- `test/`: deterministic ingestion, HTTP, algorithm, provider and cache tests.
- `integration/`: MSW 3 scenarios against the real Worker runtime and fresh local D1/KV.
- `scripts/`: explicit local live diagnostics; do not run in normal CI.

## Deployment

The API is deployed at `https://api.ride-on.cc`; `/health` reports its API version, algorithm version and deployed Git revision. Production D1
and its weather/authentication secrets are configured. Apple and Google login use `AUTH_CONFIG_JSON`; see the authentication guide. Apple Weather uses a separate `APPLE_WEATHER_CONFIG_JSON` secret; see `../docs/apple-weather.md`. See `../docs/api.md` for the
verified deployment state and commands. Local development stays on the original
local database through `preview_database_id: "ROUTES_DB"`.

Worker changes merged to main deploy automatically after the workflow checks pass
and D1 migrations apply. The workflow tags the release with its Git revision and
verifies it through quota-free health/authentication smoke checks. Manual workflow
retries also require main. The GitHub `CLOUDFLARE_API_TOKEN` needs Workers deployment, Queues
and D1 migration access. Provision `ride-monitoring` and `ride-monitoring-failed` before the first monitoring deployment; APNs credentials are optional and separate from WeatherKit. Use `bun run deploy` only when deployment is in scope. Required
secrets are `MET_OFFICE_API_KEY`, `MET_OFFICE_BPF_API_KEY`, `APPLE_WEATHER_CONFIG_JSON` and `AUTH_CONFIG_JSON`; no
Strava secrets are used. The configured CPU ceiling is 5 seconds; full collection
workloads require Workers Paid limits. Do not infer production load capacity from
local timings or the small production verification route.

Dan’s Apple login is already bound to the existing `dan` profile. Do not add a
claim step or hardcoded owner ID to clients. Legacy API keys and the claim endpoint
were removed in v0.6.0; preserve the `auth_user_owners` table and its existing rows.

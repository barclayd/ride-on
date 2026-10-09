# ride-on-api (Cloudflare Worker)

API-first ride recommender: GPX ingestion, durable route facts, modular weather
providers and deterministic route/departure ranking. The legacy `/classify` and
`/strava/*` endpoints have been removed with Dan's authorization. Existing clients
remain separate; adapt them after the API algorithm has been calibrated.

Read `../docs/api.md` for contracts, defaults, setup, validation and limitations.
Read `../docs/weather-providers.md` for verified weather mappings and provider rules.

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
bun run dev             # local Workers runtime
bun run check           # types + lint + unit + MSW 3 Workers integration tests
bun run test:unit       # Bun unit tests
bun run test:integration # Node 24+; real Workers/D1/KV, mocked HTTP boundary
bun run build:check     # bundle only; no deployment
bun run bindings        # regenerate Env after wrangler.jsonc changes
bun run lint:fix
```

## Structure

- `src/index.ts`: Hono routes and dependency composition; `createApp` accepts test dependencies.
- `src/auth.ts`: private API bearer tokens mapped to owners.
- `src/body.ts`, `request.ts`, `errors.ts`: bounded input and errors.
- `src/routes/`: GPX normalization and owner-scoped D1 persistence.
- `src/recommendations/`: strict preferences, daylight planning and pure scoring.
- `src/weather/`: generic contracts, Met Office adapter, source policy and KV-compatible cache.
- `migrations/`: D1 migrations, applied before deployment.
- `test/`: deterministic ingestion, HTTP, algorithm, provider and cache tests.
- `integration/`: MSW 3 scenarios against the real Worker runtime and fresh local D1/KV.
- `scripts/`: explicit local live diagnostics; do not run in normal CI.

## Deployment

Remote D1 setup and secrets have not been applied for this rebuild. Automatic
deployment stays off until repository variable `API_MVP_DEPLOYMENT_READY=true`. Follow
`../docs/api.md` before deploying. Workers Paid is needed for the configured
comparison workload. Never infer cloud latency/CPU results from local timings.
Use `bun run deploy` only when deployment is in scope. Required secrets are
`MET_OFFICE_API_KEY` and `API_KEYS_JSON`; no Strava secrets are used.

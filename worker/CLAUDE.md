# ride-on-api (Cloudflare Worker)

Hono worker backing the Ride On app: route surface classification (Valhalla)
and Strava OAuth token exchange. Tooling mirrors `promptly-api`: Bun, Biome,
tsgo, `bun test`, `wrangler.jsonc`.

## Conventions

- **Functional TypeScript only** — plain functions, consts, and types; no
  classes. The one sanctioned exception is `AppError extends Error` in
  `errors.ts`: subclassing `Error` is the platform's throw/catch mechanism,
  not OO design.
- **zod at the trust boundary** — every POST body is validated by a zod
  schema via `readJsonBody(c, schema)` (`request.ts`), which returns a fully
  typed body or throws a 400 `AppError` with the first issue's path+message.
  Schemas are colocated with their handlers. Upstream responses (Valhalla,
  Strava) are deliberately NOT zod-validated — we pass them through/aggregate
  defensively instead, so a new enum value upstream can't break us.

## Commands

```bash
bun install
bun run dev        # wrangler dev (local, needs .dev.vars — see below)
bun run check       # types + lint + test — must be green before shipping
bun run types       # tsgo --noEmit
bun run lint        # biome check .
bun run lint:fix    # biome check --write .
bun run test        # bun test (unit + integration; smoke tests self-skip)
bun run test:watch
bun run deploy      # wrangler deploy — requires real KV id + secrets, see below
```

## Structure

```
src/
  index.ts       Hono app: routes, logging middleware, error mapping
  errors.ts      AppError (status + code + message, optional headers)
  request.ts     readJsonBody — content-type + JSON parse guard + zod validation
  types.ts       Env bindings, Point type
  polyline.ts    Google polyline5 encode/decode (no dependency)
  geo.ts         haversine distance, total route length, lat/lon validation
  simplify.ts    Douglas-Peucker simplification, bounded to N vertices
  surfaces.ts    Valhalla edge -> surface bucket aggregation + suggestedType
  cache.ts       route-hash KV cache key (SHA-256 of quantized coords)
  classify.ts    POST /classify handler (decode -> simplify -> Valhalla -> cache)
  strava.ts      POST /strava/token, POST /strava/refresh handlers
test/
  *.test.ts            unit + integration (mocked fetch, in-memory KV stub)
  fixtures/            synthetic-but-plausible route + Valhalla response fixture
  smoke.test.ts        runs against a deployed URL, skipped unless WORKER_URL is set
```

## Endpoints

- `GET /health` -> `{ ok: true, version }`
- `POST /classify` -> `{ polyline }` or `{ coordinates: [[lat,lon],...] }` ->
  `{ surfaces: { busyRoad, paved, unpaved, path, unknown }, suggestedType, lengthKm, source, cacheHit }`.
  Rejects missing/undecodable input, >50,000 points, or >400km routes with 4xx.
  Calls Valhalla `trace_attributes` (bicycle costing) once per cache miss, 25s
  timeout; a 429/5xx from Valhalla maps to a 503 with `Retry-After`.
- `POST /strava/token` -> `{ code }` -> Strava's token response, verbatim
- `POST /strava/refresh` -> `{ refresh_token }` -> Strava's token response, verbatim

All errors: `{ error: { code, message } }`. Non-JSON `Content-Type` on a POST
is rejected with 415. Strava secrets are never included in a response, an
error message, or a log line — request logging is method/path/status/duration
only, no bodies.

## Caching

KV binding `CLASSIFY_CACHE`, keyed by SHA-256 of the simplified (Douglas-Peucker,
≤500 vertices), 5-decimal-quantized coordinate sequence. TTL 90 days.

This is route-level caching: two routes that mostly overlap but diverge at the
ends are still misses for each other. Tile-keyed caching (hash individual
snapped edges, shared across any route touching that tile) is the scalable
design noted in `PLAN.md` — worth doing once duplicate/near-duplicate route
traffic makes the miss rate matter. See the `ponytail:` comment in `src/cache.ts`.

## Local setup

```bash
cp .dev.vars.example .dev.vars
# fill in STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET from the Strava API app settings
bun run dev
```

`.dev.vars` is gitignored. For local `wrangler dev`, the `CLASSIFY_CACHE` KV
binding needs a namespace — either create a real one (below) or run
`wrangler dev` with `--local` (Miniflare simulates KV in-memory automatically,
no real namespace needed for local dev).

## Creating the real KV namespace (before first deploy)

`wrangler.jsonc` ships with a placeholder id (`"TBD-create-on-deploy"`) since
no Cloudflare credentials are assumed in this environment. Before deploying:

```bash
wrangler kv namespace create CLASSIFY_CACHE
# copy the returned id into wrangler.jsonc -> kv_namespaces[0].id
```

## Setting secrets + deploying

```bash
wrangler secret put STRAVA_CLIENT_ID
wrangler secret put STRAVA_CLIENT_SECRET
bun run deploy
```

The deployed `*.workers.dev` URL is what gets registered as the Strava OAuth
callback domain (see PLAN.md — no custom domain for v1).

## Smoke tests (post-deploy)

```bash
WORKER_URL=https://ride-on-api.<your-subdomain>.workers.dev bun test test/smoke.test.ts
```

Skipped entirely when `WORKER_URL` is unset, so `bun run check` never depends
on a live deployment.

# ride-on-app

app.ride-on.cc: Remix 3 on Cloudflare Workers (`web/SPEC.md` §11). The Worker is the BFF in front
of `ride-on-api`, reached over the `API` service binding, and serves the map shell.

- `src/worker.tsx`: the router, the sign-in handoff, sign-out and the `/api/*` proxy
- `src/session.ts`: the session and handoff cookies, PKCE and the API calls
- `src/pages.tsx`: the document, `MapShell` and the sign-in page
- `src/client/`: the hydrated `CycleMap` entry and the MapLibre mount
- `build.ts`: bundles the client and copies MapLibre, SharedUI's map style, the tokens, the favicon
  and the app icon into `public/`

## Local development

Run the API first, so the service binding has something to connect to:

```sh
cd worker
bun install
bun run migrate:local
bun run dev:session   # writes worker/.local-session.json
bun run dev           # :8787
```

Scores come from Apple Weather, so `worker/.dev.vars` needs `APPLE_WEATHER_CONFIG_JSON` (see
`docs/apple-weather.md`). Keep the local rider on Apple Weather: the Met Office key has a small
daily quota.

Then the app:

```sh
cd web/app
bun install
bun run dev:session   # copies that token into .dev.vars as DEV_SESSION_TOKEN
bun run dev           # :8788
```

On `localhost`, with no session cookie, the app signs in with `DEV_SESSION_TOKEN`. Apple and
Google sign-in can't finish locally: the API only accepts https `clientRedirects`, and the local
config has no providers.

`dev.host` in `wrangler.jsonc` keeps `request.url` on `localhost:8788`. Without it, wrangler dev
rewrites `request.url` to `app.ride-on.cc`.

## Checks

```sh
bun run check         # types, lint, tests
bun run build:check   # wrangler deploy --dry-run
```

`web-ci` runs both on every PR that touches the app.

## Deploying

Merging to `main` deploys the app to app.ride-on.cc (`.github/workflows/web-deploy.yml`). The
workflow tags the version with the commit, then checks the edge serves that build's client bundle.
`bun run deploy` still works by hand, but ask Dan first.

# app.ride-on.cc: handoff

This is where the web app stood on 30 October 2026, written for whoever picks it up next.

Read it with:

- [`SPEC.md`](SPEC.md): the what and the why
- [`app/README.md`](app/README.md): how to run the app
- [`design/README.md`](design/README.md): the design source and how to edit it

## Where it stands

1. **The spec** is in `SPEC.md` (#288). It was written from the design interview with Dan.
2. **The design is done** in Claude Design, and a copy is in `design/`. The project is
   [Ride On Web: app.ride-on.cc](https://claude.ai/design/p/2cc35dfa-ea01-4817-ab5c-66b01658558f).
   Dan called the prototype "excellent".
3. **The spike is built** in `app/` (#294). It's SPEC §14 step 5:
   - Remix 3.1 on Workers.
   - The BFF:
     - the `__Host-ro_session` cookie
     - the Apple and Google browser handoff, with PKCE
     - the `/api/*` proxy, which reaches `ride-on-api` over the `API` service binding
   - `cop()`.
   - An empty `MapShell` on the cycle map.

   Everything is verified locally except a full Apple or Google sign-in (see Gotchas).
4. **app.ride-on.cc is live** with the spike. It was deployed on 30 October 2026, as version
   `7c8a8607`.
   - The production `AUTH_CONFIG_JSON` now has the app's origin and callback.
   - The smoke checks pass:
     - `/` redirects to sign-in.
     - `/api/*` returns 401 without a session.
     - The Google start hop reaches accounts.google.com, which accepts the new callback.
   - A real Apple or Google sign-in still needs Dan in a browser (next steps, step 1).
5. **Screen 1 of the v1 screens is built**: the library on the map, in identity colours. It isn't
   deployed yet.
   - `GET /api/library-geometry` is in `app/src/geometry.ts`. It fans out to
     `/routes/:id/geometry`, six calls at a time, and returns one FeatureCollection.
   - The client is split into:
     - `client/library.ts`, which loads the library
     - `client/geometry-cache.ts`, the IndexedDB line cache, keyed `routeId@version`
     - `client/slots.ts`, which assigns the colour slots and keeps them in localStorage
   - Sign-out sends `Clear-Site-Data: "storage"`, so the next person on the device doesn't see the
     last rider's lines or colours.

## Decisions since the spec

Where the prototype and `SPEC.md` differ, the prototype wins. The spec gets updated as part of the
design export (next steps, step 3).

### Route identity colours replace the score bands

Dan asked to colour-code the routes, drop the score bands, and add a thin line so the user knows
which colour is which ride.

- **Twelve colour slots.** Each shortlisted route gets one of `--route-1` to `--route-12`, defined in
  `design/up/ride-on.css`.
- **How slots are assigned** (`addLib` and `swap` in `design/gen/proto-logic.js`):
  - A newly added route takes the lowest free slot.
  - It keeps that slot for as long as it's shortlisted.
  - In a swap, the route coming in gets the slot of the route going out.
- **Colour-blind safety:**
  - The first eight colours pass all-pairs colour-blind separation on the map.
  - Colours 9 to 12 rely on hover linking the line to its row.
- **Map lines vs panels:**
  - Map lines use the light-theme values in both themes, because the map stays light.
  - Panels use `var(--route-n)`, which is lighter in Dark Mode.
- **The thin line:**
  - The best pick card, each row and the glance card show a 3px rule in the route's colour beside
    the score (`.bar.rline`).
  - The detail's score ring also uses the route's colour.
- **Routes without a colour:**
  - Library routes that aren't shortlisted stay thin and neutral grey.
  - When paused, every route is neutral.
- **Scores still have words**, such as "Great · 82": the band thresholds survive as words only.
- **Neutral elements:**
  - Day strip bars and factor bars are neutral, and the selected day uses the label colour.
  - The verdict icons keep amber and grey.
- **What went with the bands:**
  - The focus-dimming veil (SPEC §6.4). Dan asked for the reduced-opacity map to go.
  - The map key's band chip (SPEC §6.5). The prototype's only map control is the appearance
    toggle.
- **Not updated yet:** `Screens.dc.html` still shows bands.

### Other decisions

- **Liquid Glass with real refraction**, from `design/up/glass.js`.
  - It runs only in Chromium. The gate is `CSS.supports('backdrop-filter', 'url(#a)')` plus
    `navigator.userAgentData`: Safari and Firefox accept the syntax but don't draw it.
  - Everywhere else gets the frosted base.
  - The Reduce Transparency, Increase Contrast and Forced Colors fallbacks still win.
  - There's no hard performance floor.
- **The keyboard and power-user layer** is deferred to its own spec. Dan: "let's add that
  separately".
- **The design stays in standalone claude.ai/design**, even though it closes on 14 December 2026.
  It has to be exported before then.
- **The production app is Remix 3.** Dan: "very happy for you to build the production version in
  remix 3".

## Next steps, in order

### 1. Finish checking go-live

The secret and the deploy are done. These checks need a real account, so Dan has to do them in a
browser:

- Apple sign-in, end to end.
- Google sign-in, end to end.
- Sign-out.
- `/api/*` with the session.

Each later deploy (`bun run deploy` in `app/`) is outward-facing, so **ask Dan first**.

### 2. The v1 screens (SPEC §14 step 6)

Build them one PR at a time, in this order:

1. ~~The library on the map, in identity colours.~~ Done.
2. The shortlist and scores. Things to know before starting:
   - **Panel colours:** add `--route-1` to `--route-12`, in light and dark, to the tokens. The map
     already uses `HUES` from `client/slots.ts`, which holds the light values.
   - **Swaps:** a swap has to write the outgoing route's slot to the incoming route, through the
     stored slots in `client/slots.ts`, before `assignSlots` runs. The tests already cover it.
   - **Shortlist changes** have to:
     - reset the feature state
     - re-sort the source with `setData`, so shortlisted lines still draw on top
   - **The phone fit** already leaves room for the sheet (`padding()` in `map.ts`). Until the sheet
     exists, the routes sit in a band at the top of the screen.
3. The day strip.
4. The detail.
5. Preferences and Pause.
   - Sign-out moves into Preferences.
   - Remove the `ponytail:` sign-out chip in `app/src/pages.tsx`.
6. The remaining states, including the error states in SPEC §7.8.

Port each piece from `design/`:

| From | To |
|---|---|
| `up/ride-on.css` and `up/proto.css` | `app/public/app.css` and the tokens |
| `up/map/live.js` | layers in `app/src/client/map.ts` |
| `up/glass.js` | a client entry that calls `watch()` |
| `gen/proto-logic.js` | the panel's state and views |
| `data/fixtures.js` | the test fixtures |

Also on the way:

- `/api/client-errors` and Web Analytics (SPEC §11.3)
- passkeys (SPEC §11.2)

### 3. Export the design system before 14 December 2026

This is SPEC §13 step 2.

1. **Replace the seed in `design-system/`** with tokens taken from `ride-on.css`:
   - drop the veil
   - add `--route-1` to `--route-12`
   - turn the bands into status words
2. **Update `design-system/README.md`**, including its component table.
3. **Move `glass.js` across**, with `watch()`.
4. **Bring SPEC §6.2–6.5, §8 and §13 in line** with the decisions above.

### 4. Later design work

- The state board in identity colours.
- The dark cycle map (SPEC §6.6).
- A `Design System.dc.html` page.

### 5. SPEC §14 steps 3 and 4

- **Publish the `maps/style` web build** to maps.ride-on.cc. This is outward-facing, so confirm
  with Dan first. Once it's live, the app stops copying SharedUI's style.
- **Create `packages/core` (`@ride-on/core`)** and move the extension onto it.

### 6. CI

No CI covers `web/` yet. A workflow that runs `bun run check` and `bun run build:check` in `app/`
would be cheap to add.

## Gotchas from the spike

- **`wrangler dev` rewrites `request.url` and `Host`** to the first route's host, app.ride-on.cc,
  unless `dev.host` is set.
  - That's why `wrangler.jsonc` sets `dev.host: localhost:8788`.
  - Without it, every local request looks signed out and the callback URL is wrong.
- **Workers static assets return a 307 for any path containing `@`.**
  - The build copies the 2x sprite as `sprite2x.*`.
  - `transformRequest` in `map.ts` points requests at it.
- **`cop()` rejects POSTs with `Sec-Fetch-Site: same-site`**, so other ride-on.cc subdomains can't
  post forms in. `SameSite=Lax` alone would let them.
- **Apple and Google sign-in can't finish locally.**
  - The API's config schema requires https for `baseUrl`, `trustedOrigins` and `clientRedirects`.
  - Adding an http callback breaks the local config: `/auth/me` then returns 503
    `LOGIN_NOT_CONFIGURED`.
  - Locally, `DEV_SESSION_TOKEN` signs you in on localhost instead. Get one with
    `bun run dev:session`.
- **`worker/.dev.vars` doesn't hot-reload.** Restart the API's `wrangler dev` after editing it.
- **MapLibre is vendored**: it's imported at runtime from `/vendor/` and isn't bundled. pmtiles is
  bundled into `map.js`.
- **Remix 3 idioms:**
  - A component is `function C(handle) { return () => jsx }`.
  - JSX uses `class` and `charSet`.
  - Hydrated islands use `clientEntry`.
  - The best reference is the package's own guides, in `app/node_modules/remix/guides/`.

## Working rules

- **Branch names** can be at most 23 characters, including the prefix.
- **Every change gets a PR.** Never commit to `main`. In this repo, merge your own PR with
  `gh pr merge --merge`.
- **Ask Dan before anything outward-facing:**
  - production secrets
  - deploys
  - publishing to the maps.ride-on.cc bucket
- **Secrets** go in an ignored `.dev.vars` or in Worker secrets.
- **Never log** tokens, GPX bodies, forecast bodies or auth headers (`worker/CLAUDE.md`).
- **Don't use the Modern Web Guidance skill** unless Dan asks for it.
- **The Claude Design rules** are in [`design/README.md`](design/README.md).

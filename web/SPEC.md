# app.ride-on.cc: web app spec

Status: spec, 24 October 2026, written from the design interview. Nothing is built yet.
The design comes first, in Claude Design (§13). The app, `packages/core` and the style
publishing follow in their own PRs (§14).

Read with: [`DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md) (the iOS system this borrows from),
[`docs/api.md`](../docs/api.md), [`docs/planning-api.md`](../docs/planning-api.md),
[`docs/authentication.md`](../docs/authentication.md), [`docs/maps/README.md`](../docs/maps/README.md),
[`docs/extension-design-handoff.md`](../docs/extension-design-handoff.md) and
[`extension/README.md`](../extension/README.md). The seed design system is in
[`design-system/`](design-system/README.md).

---

## 1. What it is

A signed-in web app where riders see their saved routes on Ride On's cycle map. The
shortlisted routes are coloured by how well they score on the selected day. It does what the
browser extension does, except importing routes.

- **Home is the whole library on the map**, not just the shortlist.
- **It's a companion to the extension.** The extension imports routes while you're on cycle.travel.
  The app is where you look at them. The app has no import UI, and its empty state points to
  the extensions (§7.6).
- **Audience is phased.** v1 serves existing extension users. Wider sign-ups come later with the
  landing page.
- **Desktop and mobile have equal parity.** Mobile follows the iOS Routes tab (§5.2).
- **Signed out**, `/` goes to `https://ride-on.cc`. An Astro landing page will be built there
  later as a separate project. Until it exists, `/` goes to `/sign-in`. A signed-out deep link
  goes to `/sign-in?next=<path>`.
- **Coverage is Great Britain only.** Only GB routes are supported for now. The map's `maxBounds`
  is the basemap bbox (−8.7, 49.8 → 1.9, 60.9) plus a small margin, and non-GB routes are out
  of scope.

## 2. Principles

These are DESIGN-SYSTEM.md §1, translated for the web.

1. **Ride On recommends routes; it doesn't navigate.** There's no Directions or turn-by-turn CTA.
   Actions send the route elsewhere: cycle.travel, a calendar, a GPX file.
2. **The map is the content. Glass is the functional layer.**
   - These are glass: the panel, the day strip, the map controls, popovers and the hover glance card.
   - These are solid: rows, cards and chips inside the panel.
   - Glass never sits on glass. A popover opened from the panel renders outside it, over the map.
3. **Don't copy the extension's look.** The extension is themed to feel native on cycle.travel.
   The *map* copies cycle.travel (decided in docs/maps). The *UI* takes after the iOS app.
4. **Minimal by construction.** The chrome is one floating panel, one day strip and one map-key
   chip. Anything else has to earn its place.
5. **One tinted action per screen at most**, as on iOS.
6. **Meaning is triple-encoded:** colour + symbol or number + words. A score band is never just a
   colour.
7. **The client never re-sorts or reinterprets scores.** It shows the API's order and verdicts, as
   in the extension handoff.

## 3. Phases

The design covers everything, with each screen labelled by phase. The build ships v1 first.

| Phase | Scope |
|---|---|
| **v1** | Sign-in (Apple, Google, passkey). Library on the map. Shortlist add, remove and swap. Score bands on the map. Day strip. Hover glance card. Progressive route detail. Actions (Open in cycle.travel, Add to Calendar, Download GPX, shortlist). Preferences. **Pause**. Map key and layers. Empty, loading and error states. Next good windows. Dark UI. Deep links. |
| **v2** | Track a ride and its alerts: bell, fixed departure pill, alerts popover, Move alerts, Undo. Web push. |
| **Later** | Check-in and History. A keyboard shortcut layer, scoped separately (§10). Wider audience and the landing page. The dark map shipping (§6.6). Non-GB routes. |

## 4. URLs

Deep links are private. Every URL needs a session, and nothing is publicly shareable.

| URL | Shows |
|---|---|
| `/` | Map and panel home. The selected day is the best day. |
| `/?day=2026-10-27` | Home on a chosen day. |
| `/routes/:routeId` | That route selected, with its detail in the panel (`?day=` as above). |
| `/preferences` and `/preferences/:section` | The preferences push inside the panel (§7.4). |
| `/sign-in` | Apple, Google and passkey buttons (§11.2). |
| `/auth/callback` | The browser handoff's redirect (§11.2). Never shown. |

- **Selection uses `pushState`**, so Back closes the detail.
- **The camera lives in the URL hash** (`#zoom/lat/lon`) via `replaceState`, so it never fills
  history.
- **Bare URLs:** a deep link with no hash fits the selected route, or the library.

## 5. Layout

### 5.1 Desktop and tablet (viewport ≥ 768px wide)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────┐                                    [■■■■ Bands ▾] [◐] │
│ │ Panel (glass)│                                                       │
│ │ 380px        │              map (full-bleed, focus-dimmed)           │
│ │ search  ⚙    │                                                       │
│ │ best pick    │         ╭─ glance card on hover ─╮                    │
│ │ shortlist    │                                                       │
│ │ library      │                                                       │
│ │              │       ┌─ day strip (glass) ─────────────┐             │
│ │ updated ·    │       │ Sat Sun Mon Tue Wed Thu Fri     │             │
│ └──────────────┘ © OSM └─────────────────────────────────┘             │
└────────────────────────────────────────────────────────────────────────┘
```

- **Panel:** a 380px column (the iOS iPad and Mac width), inset 12px from the top, left and
  bottom. It has a 34px radius and regular glass. The header is pinned and the content scrolls
  beneath it, fading into the bottom edge.
- **Day strip:** a glass capsule centred on the *visible* map (to the right of the panel), 16px
  above the bottom.
- **Top right:** the map-key chip (§6.5) and the theme or layers control. Nothing else.
- **"© OpenStreetMap"** sits bottom-left of the visible map, 12px right of the panel. It fades
  after 5 seconds or the first move, as on iOS.

### 5.2 Mobile (< 768px): iOS Routes parity

- The map is full-screen. The panel is a bottom sheet with iOS's two detents: **medium at 56%**
  and **large up to the safe-area top**. It never fully hides.
  - Drags track 1:1 and settle on the detent their momentum projects to (`--motion-panel-detent`).
  - Tapping the grabber toggles between the detents.
  - Pulling the content down at the large detent drops the sheet to medium.
- The day strip rides just above the sheet's top edge at medium and hides at large.
- There's no hover, so tapping a line selects it straight away. The tap tolerance is 22px, as on iOS.
- The map-key chip sits top right, below the safe area.

### 5.3 The MapShell scaffold

Every screen is the same shell with different slot contents. The map never unmounts.

- `MapShell` owns one MapLibre map and four slots: `panel`, `dayStrip`, `controls` (top right)
  and `overlay` (glance card, popovers, toasts).
- A `ResizeObserver` measures the slots and calls `map.setPadding()`. As a result, `fitBounds`,
  `easeTo` and the centre all use the visible area, not the area under the glass.
- Mobile uses the sheet's current detent height as the bottom padding.
- Each route (`/`, `/routes/:id`, `/preferences`) only swaps the slot contents, and the camera
  animates with them.

## 6. The map

### 6.1 Source

- The map is MapLibre GL JS, using the same major version as the `docs/maps` prototype (6.x).
- The style, sprite and Montserrat glyphs come from **maps.ride-on.cc**. `maps/style`'s `web`
  target publishes versioned paths (§12.3).
- The prototype and the app load the same URLs.

### 6.2 Route layers

All the library's routes go in one GeoJSON source. Three line layers, plus the selection's
markers, sit **below the map's label layers**:

1. **`routes-hit`:** invisible, 22px wide. It handles hover and click, so thin lines are easy to hit.
2. **`routes-casing`:** a white casing under the coloured line.
3. **`routes-line`:** colour and width by state. Changing state uses `setFeatureState`, never a
   data rewrite.

| State | Line |
|---|---|
| Unscored (in library, not shortlisted) | Thin (2px) neutral grey, no casing |
| Scored | Band colour (§6.3), 4px, white casing |
| Not recommended (< 50) | Muted band colour, 2.5px, thinner casing |
| Hovered | +2px, drawn above the others |
| Selected | Keeps its band colour, 6px. Everything else fades to 35% opacity. Start and Finish markers (Finish only when the ride doesn't end where it started). Direction chevrons along the line from z12. |
| Paused (§7.5) | Every line is neutral, as unscored |
| Checking the forecast | Every scored line goes neutral until the new scores land, then crossfades back (§7.7) |

### 6.3 Score bands

The four bands reuse the extension's thresholds. They move into `@ride-on/core` (§12.2), so
the extension and the web share one definition. Colours are per surface: the extension keeps its
cycle.travel-native colours, and the web takes its own from the design system.

| Score | Band | Web colour (seed) | Words |
|---|---|---|---|
| ≥ 75 | Great | accent green | "Great · 82" |
| 60–74 | Good | yellow-green | "Good · 68" |
| 50–59 | Fair | amber | "Fair · 54" |
| < 50 | Not recommended | muted grey, thinner | "Not recommended · 41" |

- **Contrast:** each band colour needs 3:1 against the dimmed land colour (§6.4) in both map
  themes.
- **Never alone:** a band is always shown with its score and its word in the panel, the glance
  card and the map key.
- **Verdicts outrank bands:** "Below your minimums" and "Doesn't fit your window" come from the
  API (`best.standards`, `unranked`). They show beside the band.

### 6.4 Focus dimming

The cycle overlay's own colours (red NCN dots, orange cycleways, purple lanes) clash with
the bands, so the map steps back while routes are shown.

- **A veil layer:** one world-covering `fill` layer in the land colour at ~60% opacity, inserted
  above the basemap and overlay and below the labels and route layers. Toggling one layer is cheap.
  Re-styling 85 layers isn't.
- **Zoom fades the veil out from z13 to z14**, so the full cycle map comes back when you're
  close enough to read paths.
- **"Full cycle map"** in the layers popover turns the veil off entirely.

### 6.5 Map key (minimal)

- **Collapsed:** a small glass chip at top right with the four band swatches.
- **Open:** a glass popover with:
  - the four bands, each with its range and word
  - a **Full cycle map** switch (the veil, §6.4)
  - a compact cycle network legend: NCN, RCN, cycleway, gravel, cycle lane, drawn from
    `docs/maps/cycle-travel-style.md`

### 6.6 Dark mode

- **The UI follows the system**, with light and dark tokens in the design system.
- **The dark map is for Claude Design to explore** (§13): land, water, roads, the network colours
  and labels, plus a check of the band colours over it. A dark style that works answers open
  decision 6 in `docs/maps/README.md`.
- **Until a dark style ships**, the map stays light in Dark Mode. The controls over it are held
  light too, as on iOS (DESIGN-SYSTEM.md §2).

### 6.7 Hover glance card (desktop only)

Hovering `routes-hit` opens a small glass card anchored near the cursor.

- **Timing and placement:** 120ms in, a 100ms grace on leave. It sits 16px from the cursor and
  flips at the viewport edges.
- **A scored route shows:**
  - name
  - band word and score
  - day, departure → ~finish
  - up to three condition chips (temperature range, wind, rain)
  - any verdict ("Below your minimums")
- **An unscored route shows:** its name, ↔ distance, climb and "Add to shortlist to score it".
- **Overlapping lines:** when several lines are under the cursor, it lists up to three, best score
  first.
- **Click selects.** The card is never the only way to get its information: the panel row says
  the same.

### 6.8 Selected route

- **The camera** fits the route inside the padded visible area (§5.3).
- **Profile ↔ map scrub:** hovering or dragging along the detail's profile moves a dot along the
  route on the map. Hovering the selected line moves the profile's cursor.
- **Wind view:** a "Show wind on the map" toggle in the detail's Wind section (default off). While
  it's on, the selected line is drawn by wind effect from `best.windStretches`:
  - tailwind in the accent, crosswind orange, headwind red, light wind grey
  - a worded legend beside the toggle
  - where the road is ridden twice, the return is offset, as in iOS's `WindRouteMap`
  - turning it off restores the band colour

## 7. The panel

### 7.1 Home: best pick card + list

From the top:

1. **Header (pinned):**
   - a "Search routes" field, which filters the library and shortlist by name on the client
   - a preferences button (⚙)
2. **Best pick card (solid):**
   - "Best pick · Sat" pill, route name and band score
   - departure → ~finish, ↔ distance and climb
   - up to 4 condition chips
   - verdict line ("✓ Meets your preferences" or "⚠ Below your minimums")
   - clicking it selects the route
3. **Shortlist, "4 of 12":** rows in the API's ranking order. Each row has:
   - band swatch and score, name, departure → ~finish, distance
   - one line of conditions, and the verdict where there is one
   - the ▲/▼ change badge from `best.scoreChange`
4. **Doesn't fit your window:** the API's `unranked` routes, with the reason in words.
5. **Library:** every other route, newest first, as the API orders it. Each row has the name,
   "42 km · 180 m · 46% unpaved" (surface from `/routes/:id/surface`) and the source. Hovering or
   selecting a row shows **Add to shortlist**.
6. **Footer:**
   - "Updated 08:12"
   - the weather provider's attribution, as the extension shows it (`GET /weather-providers`)
   - "Forecast retrieved …" wording, per the extension handoff

Rows and the map stay in sync:
- Hovering a row highlights its line on the map.
- Hovering a line highlights its row.
- Selecting either does both.

### 7.2 Route detail (progressive, iOS split)

Selecting a route pushes its detail into the panel. The first screen is a compact summary, and
more sections follow as you scroll, mirroring iOS Ride detail (DESIGN-SYSTEM.md §9).

1. **Verdict card:**
   - score ring
   - band word and verdict
   - change since the last update
   - last ridden
   - one or two notes (`message`, `best.drawbacks`)
2. **Departure:** the best departure plus up to three alternatives (the API's tested
   alternatives). Choosing one updates everything below it.
3. **Forecast on the ride:** an hourly grid of time, sky, temperature, wind, gusts and rain
   chance (`best.rideHours`).
4. **Sky on the ride:** the sky share bar (`skyConditionShares`).
5. **Wind on the ride:**
   - "Wind from the south-west" beside a wind compass
   - the wind share bar
   - gusts
   - the "Show wind on the map" toggle (§6.8)
6. **Along the route:** the profile, on a km axis, scrubbable and synced with the map (§6.8):
   - an elevation area (API gap, §12.5)
   - the wind strip (`windStretches`)
   - temperature along the ride (`temperatureAlongRide`)
7. **Why it scored N:** factor rows, sorted high to low, each with a bar and one plain sentence.
8. **Actions** (plain accent buttons, none of them tinted):
   - **Open in cycle.travel.** Only for routes with `source.providerId === "cycle-travel"`. It
     opens the journey page built from `source.externalId`; `extension/lib/cycletravel.ts` knows
     the paths.
   - **Add to Calendar.** A small menu with **Google Calendar** (a template link) and
     **Apple / Outlook (.ics)**, an `.ics` file generated on the client. Both carry the route
     name, departure → estimated finish, the score in the notes and a link back to
     `/routes/:id?day=`.
   - **Download GPX** (API gap, §12.5).
   - **Add to shortlist** or **Remove from shortlist**.
9. The weather attribution.

Unscored routes show only the header, the facts, the surface and **Add to shortlist**, which
scores the route straight away (§7.3).

### 7.3 Shortlist

- **Add** sends `PUT /route-selection` with the new list and `version`, then scores at once:
  - the line and row go to "Checking the forecast…"
  - then they take their band
- **The cap is 12.** Adding a 13th opens the **swap popover**, a glass popover over the map:
  - it lists the 12 with their scores, the lowest-scoring one pre-selected
  - **Swap** is the one tinted action; **Cancel** backs out
  - it's one decision and is never silent
- **On `409 SELECTION_VERSION_CONFLICT`:** refetch, re-apply the rider's change if it still makes
  sense, and otherwise re-show the popover with the fresh list. Never retry blindly.
- **Remove** is immediate, with an Undo toast in the overlay slot.

### 7.4 Preferences (panel push)

The panel pushes to Preferences with a back chevron. The map stays put. **Every change saves
straight away** (`PATCH /users/me` with `expectedVersion`, debounced). There's no "try without
saving" mode. Scores refresh and the map recolours as you go, so the effect of a preference is
visible on the map.

The sections map the extension's Prefs and When tabs onto the iOS screens:

- **Ideal temperature:** a range on the temperature ramp, seasonal temperatures, deal-breakers.
- **Comfortable wind:** the wind envelope, with headwind, crosswind and gust sliders and crosswind
  sensitivity.
- **Rain:** "Don't mind / Prefer dry / Strongly prefer dry".
- **Sunshine and climbing.**
- **Distance:** the extension's `DistanceCard`. "No limit" is a real choice.
- **When:** "Daylight hours" or "Choose times" (Leave after and Back by).
- **Riding:** average speed and departure interval.
- **Units.**
- **Pause Ride On (v1):** the extension's choices, today + 3, today + 7 or "Until I turn it back
  on" (`PUT /users/me/pause`).
- **Account:**
  - sign-in methods
  - **passkeys:** list, add, rename, remove (§11.2)
  - sign out
- **About:** the map credits, as in iOS Preferences → Maps (OpenStreetMap, Protomaps, terrain
  sources, each linking to its terms), weather attribution and the version.

On a `409` version conflict, refetch the profile and re-apply the edited field.

### 7.5 Paused: quiet map

While `user.pause` is set:

- **Lines go neutral**, as unscored.
- **The day strip hides.**
- **No forecast calls are made.**
- **The panel's top shows a card:** "Ride On is paused until Mon 3 Nov" (or "until you turn it
  back on"), with **Resume** (`DELETE /users/me/pause`) as the one tinted action.
- **The library stays browsable:** names, distances and the map all work.
- **Resuming** fetches fresh recommendations (the extension's behaviour).
- **`resumesAt`:** the client compares against it. It never calculates the time itself.

### 7.6 Empty state (no routes)

- The map rests on a GB overview, veil off.
- The panel shows one solid card:
  - **Import routes from cycle.travel**
  - one line of how-to: "Install the extension, open a journey on cycle.travel and save it"
  - **Add to Chrome** and **Add to Safari**
- Preferences stay reachable from the header.

### 7.7 Loading: stale-while-revalidate

This mirrors iOS's cached ride board (#287, `docs/app-loading.md`).

- **Paint saved content first.** The last recommendation response for this user, day and profile
  version is kept in IndexedDB. It paints at once, labelled "Updated 2h ago".
- **Refresh in the background**, then crossfade the bands and re-rank the rows
  (`--motion-materialize`, `--motion-snappy`).
- **Honour `weather.refreshAt`.** Don't re-ask before it unless the profile, the shortlist or the
  day changed.
- **Day change:**
  - scored lines go neutral
  - a glass "Checking the forecast…" pill shows in the overlay slot
  - when the scores land, they pour in together
- **Library geometry** is cached per `routeId@version`, which never changes for a version
  (§12.4).

### 7.8 Other states the design must cover

- **Forecast incomplete:** `availability: partial` or `none`.
- **Below your minimums** and **No match:** `minimumStandardsStatus: none_meet`. These use the
  extension handoff's copy.
- **Next good windows:** when nothing fits this week, from `POST /recommendations/next-windows`,
  as in the extension.
- **Elevation unavailable**, with the handoff's copy.
- **Session expired:** go to `/sign-in?next=`.
- **API unreachable or offline:** keep the cached content with a quiet "Couldn't refresh" footnote.

## 8. Day strip

- **Next 7 days:** today + 6, from one multi-day request (`days: {kind: "range"}`, see
  planning-api.md "Day tiles").
- **Bars:** each day is a bar whose height and band colour are that day's best score, with the
  day name and the number.
- **Days that can't be ridden:**
  - rain-out days show a symbol and a stub
  - days with `availability: none` or no feasible ride are shown but can't be selected
- **The best day is pre-selected:** the highest best score, with the earliest winning a tie.
  Choosing a day updates `?day=`, the panel and the map.
- **Accessibility:** it's a row of buttons with the selected state (`aria-pressed`) and a visually
  hidden summary sentence. On iOS, `DayStrip` is the model.

## 9. Liquid Glass on the web

The rider chose **maximum fidelity**, with **no hard performance floor**: ship it and react to
real reports.

- **Frosted base everywhere:**
  - `backdrop-filter: blur() saturate()` over a translucent tint
  - a rim highlight as inset shadows
  - a soft outer shadow
  - recipe tokens in `design-system/tokens.css`
- **Refraction on top where supported:** an SVG `feDisplacementMap` lens via
  `backdrop-filter: url(#glass)`. Only Chromium supports it, so Safari and Firefox keep the frosted
  base. Detect support with `CSS.supports`, never the user agent.
- **Regular glass only.** The cycle map is light, so iOS's rule applies: controls over it use
  regular glass, held light in Dark Mode while the map stays light.
- **Fallbacks are not optional:**
  - `prefers-reduced-transparency: reduce` → opaque surfaces
  - `prefers-contrast: more` → solid with a visible border
  - `forced-colors: active` → system colours, no backdrop
- **Glass never sits on glass.** Glass that touches or morphs (the day strip and the
  checking-forecast pill) shares one layer, rather than glass being stacked.

## 10. Accessibility

- **The list is the accessible path.** Everything on the map (select, hover facts, scores, wind)
  is reachable from the panel. The canvas is labelled, and its lines aren't focusable.
- **Contrast:** 4.5:1 for text, 3:1 for large text and graphics, including the band lines (§6.3).
- **Triple encoding everywhere**, with the extension handoff's wording.
- **Hit areas:** 44px touch targets and the 22px line hit area.
- **`prefers-reduced-motion`:** the camera jumps instead of flying, re-ranks crossfade, and the
  detents settle with `--motion-smooth`.
- **Text resizing:** respects the browser font size. Type sizes are in `rem`.
- **Out of scope here:** keyboard shortcuts beyond the platform's (Tab, Enter, Esc and focus
  rings) are their own later piece of work.

## 11. Architecture

### 11.1 Stack

- **App:** `web/app/` is **Remix 3** (`remix` 3.1.x) on **Cloudflare Workers**, as the Worker
  `ride-on-app` on `app.ride-on.cc`.
- **Remix 3's component model:** setup runs once and returns a render function, state is plain
  variables plus `handle.update()`, and there are no hooks.
  - The panel and the day strip are server-rendered JSX.
  - `MapShell`'s map is a hydrated client entry.
  - `<Frame>` handles partial updates where useful.
- **Risk:** Remix 3 doesn't document Workers explicitly. It is Fetch-API based, so the first
  scaffold PR is a spike that proves SSR, hydration and the service binding on Workers before
  anything else is built.
- **Tooling:** Bun, Biome and TypeScript, as in `extension/` and `worker/`.

### 11.2 Auth: same-origin BFF

`api.ride-on.cc`'s cookies are host-only, so the app Worker acts as a backend-for-frontend:

- **The proxy:** `app.ride-on.cc/api/*` forwards to `ride-on-api` over a **service binding**
  (`API`), so there's no public hop. The browser only ever talks to its own origin.
- **The session** is a Better Auth session. Its token lives in `__Host-ro_session`
  (`HttpOnly; Secure; SameSite=Lax; Path=/`, 7 days).
  - The BFF forwards it as `Authorization: Bearer`.
  - It stores any `set-auth-token` refresh the API returns.
  - The token never reaches JavaScript.
- **Apple and Google** use the existing **browser handoff** (docs/authentication.md), run
  server-side:
  - `/sign-in` posts to the BFF, which runs `/auth/browser/start` with
    `redirectUri: https://app.ride-on.cc/auth/callback`.
  - The PKCE verifier and `state` are kept in a 10-minute `__Host-ro_handoff` cookie.
  - `/auth/callback` checks `state`, runs `/auth/browser/exchange` and sets `__Host-ro_session`.
- **Passkeys:**
  - `/sign-in` runs WebAuthn with `@better-auth/passkey/client` pointed at the BFF's
    `/api/auth/passkey/*`.
  - The BFF passes the challenge cookie and the browser's `Origin` through.
  - On `verify-authentication`, it turns the `set-auth-token` (the API's `bearer()` plugin is on)
    into `__Host-ro_session`.
  - This page is the "Ride On login page … for web passkey prompts" that authentication.md
    says is missing.
- **Sign out:** the BFF calls the API's sign-out with the bearer, then clears the cookie.
- **API configuration** (in `AUTH_CONFIG_JSON`; no code change expected):
  - add `https://app.ride-on.cc` to `trustedOrigins` (the passkey origin list is
    `baseUrl + trustedOrigins`)
  - add `https://app.ride-on.cc/auth/callback` to `clientRedirects`

### 11.3 Observability (Cloudflare-native only)

- **App Worker:** `observability.enabled: true` (Workers Logs and traces), as the API has.
- **Cloudflare Web Analytics:** the cookieless beacon.
- **`POST /api/client-errors`:** a small BFF endpoint for uncaught errors and unhandled
  rejections.
  - It records the message, stack, path, release and UA, and logs them to Workers Logs.
  - It sends no route names, coordinates or tokens, and is rate-limited per session.
- **No third-party services.**

## 12. Data

### 12.1 Endpoint map

| Feature | Endpoint |
|---|---|
| Library | `GET /routes` (all pages, `limit=100`) |
| Line geometry | `GET /routes/:id/geometry` (polyline6), batched by the BFF (§12.4) |
| Surface | `GET /routes/:id/surface` |
| Shortlist | `GET` / `PUT /route-selection` (max 12, `version`, 409) |
| Day strip | `POST /recommendations` with `days: {kind: "range", start, end}` over the shortlist |
| Selected day's ranking | `POST /recommendations` for that date. Reuse the multi-day response if it already carries per-day rankings; check this while building. |
| Next good windows | `POST /recommendations/next-windows` |
| Profile, preferences | `GET` / `PATCH /users/me` |
| Pause | `PUT` / `DELETE /users/me/pause` |
| Weather attribution, provider | `GET /weather-providers` |
| v2: tracking, alerts, push | `/tracked-rides`, `/push-devices` |

`POST /recommendations` only scores the `routeIds` it's given, which is why only shortlisted
routes are coloured.

### 12.2 Shared package: `packages/core` (`@ride-on/core`)

- **Workspace:** a root Bun workspace covers `extension`, `web/app` and `packages/*`.
- **Contents:**
  - score bands and thresholds (75 / 60 / 50)
  - en-GB date, time, distance and unit formatting
  - the wind, temperature and rain derivations now in `extension/ui/{format,wind,temperature,rain}.ts`
  - API types (`extension/lib/types.ts`)
  - a fetch-based API client with the base URL and auth injected
- **Pure TypeScript.** No DOM and no Preact.
- **Migration:** the extension moves onto it in its own PR (Chrome and Safari both checked). The
  extension keeps its own colours.

### 12.3 Map style assets on maps.ride-on.cc

`maps/style`'s `web` target builds and uploads to the `ride-on-maps` bucket. CORS is already `*`.

- `style/v1/light.json`, plus `style/v1/dark.json` once designed. These are short-cached and
  point at the archives.
- `sprite/v1/…` and `glyphs/v1/{fontstack}/{range}.pbf`. These are immutable and long-cached.
- The Claude Design prototype, the app and any future landing page all load these URLs.

### 12.4 Library geometry

There's one geometry request per route, so a big library means many requests.

- **The BFF** serves `GET /api/library-geometry`. It fans out over the service binding with
  limited concurrency and returns one GeoJSON `FeatureCollection` keyed by `routeId@version`.
- **The client** caches features in IndexedDB by that key. A route's geometry never changes for
  a version.
- **Upgrade path:** if it's ever slow, an API-side `GET /routes?include=geometry` replaces it.

### 12.5 API gaps (needed before the matching UI ships)

- **Download GPX:** there's no endpoint yet. The proposal is `GET /routes/:id/gpx`, returning the
  stored GPX for the owner.
- **Elevation for the profile:** geometry carries no elevation, and `outline` is
  `[lat, lon, distanceM]`.
  - The proposal is an elevation series on a distance axis (e.g. `GET /routes/:id/profile`).
  - Until it exists, the profile shows the wind strip and temperature only.

## 13. Claude Design brief

- **Where:** a standalone **claude.ai/design** project, "Ride On Web: app.ride-on.cc". Standalone
  Claude Design closes on **14 December 2026**, so export the design system and prototype before
  then.
- **Never** use the AnyVan design system.
- **Design system flow (design-first):**
  1. Claude Design builds the "Ride On Web" design system, starting from:
     - the seed in [`design-system/`](design-system/README.md)
     - `DESIGN-SYSTEM.md`
     - this spec
  2. Once the look settles, it's exported into `web/design-system/`, replacing the seed.
  3. From then on, the repo copy wins.
- **Deliverables:**
  1. **An interactive prototype on live MapLibre**, using the real tiles and style from
     maps.ride-on.cc.
     - **Fixtures:** about 10 real GB routes in fixture JSON shaped exactly like the
       `docs/api.md` responses, so components port straight to the app. The default camera is
       Richmond and Kingston (51.4455, −0.2665).
     - **Viewports:** desktop 1440 × 900 and mobile 393 × 852.
     - **Theme:** a light/dark toggle.
     - **Happy path:**
       1. Land on the best day, with the best pick card shown.
       2. Hover a line to see the glance card.
       3. Click to see the detail.
       4. Scrub the profile against the map.
       5. Turn on the wind view.
       6. Change the day ("Checking the forecast…").
       7. Add a 13th route and see the swap popover.
       8. Push into Preferences and watch a temperature change recolour the map.
       9. Pause, then Resume.
  2. **A static state board**, every frame labelled **v1**, **v2** or **later**:
     - stale-while-revalidate and checking forecast
     - paused (quiet map)
     - empty library
     - shortlist full
     - forecast incomplete
     - below your minimums and no match
     - doesn't fit your window
     - next good windows
     - elevation unavailable
     - sign-in (Apple, Google, passkey)
     - session expired
     - couldn't refresh
     - Reduce Transparency and Increase Contrast
     - v2 tracking: bell, fixed departure pill, alerts popover, Move alerts, Undo, web push
       permission
     - later: check-in and History
  3. **A dark cycle map exploration** (§6.6), with the band colours checked over it.

## 14. Build order

1. **This PR:** the spec and the design-system seed.
2. **Claude Design:** the design system, the prototype and the state board. Then export to
   `web/design-system/`.
3. **`maps/style` web publishing** to maps.ride-on.cc (§12.3).
4. **`packages/core`** with the root workspace, and the extension migrated onto it.
5. **The `web/app` spike:** Remix 3 on Workers, the service binding, the BFF auth and an
   empty `MapShell`.
6. **v1 screens**, in this order:
   1. the library on the map
   2. the shortlist and scores
   3. the day strip
   4. the detail
   5. Preferences and Pause
   6. the remaining states
7. **The API gaps** (§12.5), when the matching UI is next.

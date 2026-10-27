# Ride On Web: the Claude Design source

This folder is a copy of the Claude Design project
[Ride On Web: app.ride-on.cc](https://claude.ai/design/p/2cc35dfa-ea01-4817-ab5c-66b01658558f). The
project is private. The copy was taken on 27 October 2026 and matches the project byte for byte.

Standalone Claude Design closes on 14 December 2026. After that, this folder is the design's home.

## What's here

### `up/`: the project's files, as uploaded

- **`Prototype.dc.html`:** the interactive prototype (SPEC §13, deliverable 1). It runs the happy
  path on live MapLibre, and its guide steps through the nine moments.
- **`Screens.dc.html`:** the static boards 1a–3g on desktop and mobile:
  - home
  - detail
  - Preferences
  - the swap popover
  - paused
  - empty

  These boards still use score bands. They haven't had their identity-colour pass yet.
- **`ride-on.css`:** the screen styles and tokens:
  - light and dark
  - `--route-1` to `--route-12`
  - the glass recipe and its fallbacks
- **`proto.css`:** what the prototype adds on top: views, motion and neutral day bars.
- **`glass.js`:** Liquid Glass refraction (SPEC §9).
  - It only runs in Chromium.
  - `RideOnGlass.refractAll()` applies it to every `.glass` element.
  - `RideOnGlass.watch()` also follows elements added later and refits a lens when its element
    resizes.
- **`map/cyclemap.js`:** the map loader and the static boards' maps.
  - It loads MapLibre and the cycle map.
  - The style is SharedUI's, pinned to a repo commit on jsDelivr. The tiles come from
    maps.ride-on.cc.
- **`map/live.js`:** the prototype's one live map.
  - One GeoJSON source holds every route.
  - It has three layers: hit, casing and line.
  - All route state goes through `setFeatureState`.
- **`map/routes.js`:** the 15 fixture routes, in polyline6.
- **`map/elev.js`:** the elevation profiles for those routes.

### `gen/`: the scripts that write `up/`

- **`screens.py`** writes `Screens.dc.html`.
- **`proto.py`** writes `Prototype.dc.html`. It reuses the markup from `screens.py` and adds
  `proto-logic.js`.
- **`proto-logic.js`** holds the prototype's state and handlers, in readable form. Port from this
  file.
- **The fixture pipeline** runs in this order:
  1. `routes.py` fetches loops from the public OSRM bike router.
  2. `fixtures.py` adds EU-DEM elevation and writes JSON shaped like the API's.
  3. The result is `data/fixtures.js`.
  4. `slim.js` and `elev.js` write the files in `up/map/`.

### `data/fixtures.js`: the fixtures

The fixtures are shaped like the `docs/api.md` responses, so the app can use them as test data.

## Regenerating

Run these from `web/design`:

```sh
python3 -I gen/screens.py
python3 -I gen/proto.py                           # also writes gen/proto-check.js (ignored)
node gen/slim.js                                  # data/fixtures.js → up/map/routes.js
node gen/elev.js data/fixtures.js up/map/elev.js
```

## Viewing

The `.dc.html` files need `support.js`, Claude Design's runtime, saved next to them in `up/`.

`support.js` isn't checked in; `.gitignore` ignores it. There are two ways to view the files:

- open them in the project
- get `support.js` from the Claude Design MCP's `create_support_js`, then serve the folder with
  `python3 -m http.server -d up`

## Editing the project

1. Edit `gen/`, or the `.css` and `.js` files in `up/`.
2. Regenerate.
3. Upload the changed files with the Claude Design MCP's `write_files`.
   - Pass each file's current etag as `if_match`. `list_files` gives the etags.
   - For a new path, pass `"0"`.

The project's markup rules:

- Close every element, and self-close void elements.
- Use double quotes for attributes.
- Put a `data-screen-label` on each screen.
- Don't use `scrollIntoView`.
- Don't put text holes inside `<svg>`.
- Keep each file under about 1000 lines.
- Never upload `support.js`.

Two more rules:

- **Never use the AnyVan design system.** The project has it auto-attached under `_ds/`, so ignore
  that folder.
- **Never put a preview's `serve_url` in the repo or in chat.** That means any
  `*.claudeusercontent.com` link. Share only claude.ai/design links.

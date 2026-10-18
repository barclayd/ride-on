# Cycle map: handover, 18 October 2026

State of the cycle map work when the previous agent stopped, so a fresh agent can take over without that
conversation. Read [`README.md`](README.md) (the plan) first; this doc only adds what isn't in it yet.
Delete this file in the PR that merges the last item below, folding anything still useful into the plan.

Two pieces of work are open, both on pushed branches:

1. **WS1.1, tiles on R2:** blocked on an R2 API token from Dan. The upload method has to change (below).
2. **WS2.5 batch D (density):** written but not verified against cycle.travel, which needs Chrome
   DevTools MCP. It didn't work from the last session (below).

## Before you start: two things only Dan can do

1. **Create an R2 API token and store it in an AWS CLI profile called `r2`**, in his own terminal
   ([details](#1-r2-credentials-dan)). Never ask for the keys in chat, and don't run `aws configure`
   through `!` either: both put the secret in the transcript.
2. **Run the agent somewhere Chrome DevTools MCP can attach**: a foreground Claude Code session in a
   terminal (Ghostty works), not a background job, or give the background host Full Disk Access
   ([details](#chrome-devtools-mcp)).

## Where things are

| What | Where | State |
|---|---|---|
| WS1.1 branch | `maps/ws1-basemap`, commit e6b3a56 | Pushed. Hosting scripts and docs. Based on an old main (c829efd, PR #226): rebase with care ([below](#6-rebase-and-merge-mapsws1-basemap)) |
| Batch D branch | `maps/ws2-density`, commits 055a3cc and fafc3f6; worktree `~/Developer/ride-on-maps-style` | Pushed, clean. Based on #258; main has changed nothing under `docs/maps`, `maps/` or `CycleMap/` since, so the rebase should be clean |
| GB basemap | `~/Developer/ride-on-maps-data/tiles/basemap-gb-20261017.pmtiles`, 3,005,193,777 bytes | Not on R2 yet |
| GB cycling overlay | `~/Developer/ride-on-maps-data/tiles/cycling-gb-20261017.pmtiles`, 125,517,191 bytes | Not on R2. Built at 22:23 from the batch D working tree; rebuild before publishing ([below](#5-the-cycling-overlay)) |
| OSM extract | `~/Developer/ride-on-maps-data/osm/united-kingdom-261017.osm.pbf` | Input to the overlay build |
| Prototype data | `~/Developer/ride-on-maps-style/docs/maps/prototype/data/` | Symlinks to the two archives above, for `bun run style:local` |
| Prototype server | `bun run serve` in that prototype folder, port 8787 | May still be running from the last session: `lsof -nP -iTCP:8787 -sTCP:LISTEN` |
| Old captures | `~/Developer/ride-on-maps-data/map-shots/` | Batch D work captures, taken before fafc3f6. Reference only; re-take everything |
| R2 bucket | `ride-on-maps`, location WEUR, account `3343118697a4beccae42090c4520cd29` | Created. Custom domain `maps.ride-on.cc` attached (zone `41c8b77faa3495ea01f6594b00e6d34d`), CORS set (`maps/hosting/cors.json`). Empty apart from one unfinished multipart upload |

Disk is nearly full (about 21 GB free). Don't copy the archives; symlink or hard-link them.

## WS1.1: publishing the tiles to R2

### Why the Worker upload failed

`maps/hosting/publish.sh` on `maps/ws1-basemap` deploys a temporary Worker (`ride-on-maps-upload`) and
streams 64 MiB parts through it into an R2 multipart upload. It works but crawls: 16 of 45 parts
(1.07 GB) in about 7½ hours, with connection resets.

- The line is fine: 13 MB/s up to Cloudflare (speed.cloudflare.com, IPv4 and IPv6), and Bun's `fetch`
  reaches the same rate.
- The bottleneck is the Worker's `uploadPart(partNumber, request.body)` into R2: about 8 KB/s per
  connection, with the socket's send queue full (about 128 KB). That's on Cloudflare's side; more
  concurrency doesn't help enough.
- The dashboard upload is capped at 300 MB and `wrangler r2 object put` at 300 MiB, so neither takes the
  3 GB basemap.

The upload was stopped on 18 October; its exit trap deleted the Worker. The 16 parts it sent are still
in R2 as an unfinished multipart upload (id starting `ABLxz8XVd3uA`). R2 drops it after 7 days; abort it
anyway (step 3).

The fix is to upload straight to R2's S3-compatible endpoint with the AWS CLI, as the plan's WS1.5
already says for scheduled rebuilds. Expected to run near line speed (about 4 minutes for the basemap),
but not measured yet: watch the rate the CLI prints, and try rclone with 64 MB chunks if it's slow too.

### Dan's AWS profiles: read this first

Dan's `~/.aws/config` holds his employer's profiles (production, break-glass, sandbox and others) and a
`default` profile. **Every `aws` command in this work must pass `--profile r2` and the R2
`--endpoint-url`.** Never run `aws` without them, never use or change another profile, and never read
`~/.aws/credentials`.

### 1. R2 credentials (Dan)

1. Cloudflare dashboard → R2 → Manage API tokens → Create API token. Permission **Object Read & Write**,
   applied to the **`ride-on-maps`** bucket only. Note the Access Key ID and Secret Access Key; the
   secret is shown once.
2. In his own terminal:

   ```sh
   aws configure --profile r2
   # AWS Access Key ID:     <from step 1>
   # AWS Secret Access Key: <from step 1>
   # Default region name:   auto
   # Default output format: json
   ```

When Dan says it's done, check without printing secrets: `aws configure list-profiles | grep -x r2`.

### 2. Profile settings (agent, no secrets)

```sh
aws configure set s3.multipart_chunksize 64MB --profile r2
aws configure set s3.max_concurrent_requests 8 --profile r2
aws configure set request_checksum_calculation when_required --profile r2
aws configure set response_checksum_validation when_required --profile r2
```

The installed CLI is 2.28.5. From 2.23 it sends CRC checksums on every upload by default; the last two
lines keep it to what S3 requires, which Cloudflare's R2 docs give for the CLI. If an upload still fails
with a checksum or `NotImplemented` error, that is the first thing to look at.

### 3. Check the bucket and abort the stale upload

```sh
R2=https://3343118697a4beccae42090c4520cd29.r2.cloudflarestorage.com
aws s3 ls s3://ride-on-maps/ --profile r2 --endpoint-url "$R2"          # expect nothing
aws s3api list-multipart-uploads --bucket ride-on-maps --profile r2 --endpoint-url "$R2"
aws s3api abort-multipart-upload --bucket ride-on-maps --key basemap-gb-20261017.pmtiles \
  --upload-id '<the ABLxz8XVd3uA… UploadId from the listing>' --profile r2 --endpoint-url "$R2"
```

Do this before starting the new upload, so you can't abort the wrong one.

### 4. Upload and verify the basemap

Keys are dated and immutable: apps cache them for a year. `aws s3 cp` overwrites silently, so check the
key is free first.

```sh
R2=https://3343118697a4beccae42090c4520cd29.r2.cloudflarestorage.com
FILE=~/Developer/ride-on-maps-data/tiles/basemap-gb-20261017.pmtiles
KEY=basemap-gb-20261017.pmtiles

aws s3api head-object --bucket ride-on-maps --key "$KEY" --profile r2 --endpoint-url "$R2"   # expect a 404 error

aws s3 cp "$FILE" "s3://ride-on-maps/$KEY" --profile r2 --endpoint-url "$R2" \
  --content-type application/vnd.pmtiles \
  --cache-control "public, max-age=31536000, immutable"

aws s3api head-object --bucket ride-on-maps --key "$KEY" --profile r2 --endpoint-url "$R2"
# ContentLength 3005193777, ContentType application/vnd.pmtiles, CacheControl as above

U=https://maps.ride-on.cc/$KEY
curl -s -r 0-16383 -o /dev/null -w '%{http_code} %{size_download}\n' "$U"    # 206 16384
curl -s -r 0-6 "$U"; echo                                                    # PMTiles
SIZE=$(stat -f %z "$FILE")
curl -s -r $((SIZE - 1048576))-$((SIZE - 1)) "$U" | cmp - <(tail -c 1048576 "$FILE") && echo "tail matches"
pmtiles show "$U"
```

Run the upload in the background (`run_in_background`) and let it finish; don't poll it with `sleep`.
Then open the prototype with `bun run style` (R2 URLs) and check it renders at a few places.

### 5. The cycling overlay

Publish it the same way (126 MB, so `wrangler r2 object put` would also work, but use one method). Only
publish it once batch D is merged, from a fresh build of the merged profile:

```sh
~/Developer/ride-on-maps-style/maps/tiles/build.sh \
  ~/Developer/ride-on-maps-data/osm/united-kingdom-261017.osm.pbf \
  ~/Developer/ride-on-maps-data/tiles/cycling-gb-20261017.pmtiles
```

(About 2 minutes, needs Docker; run it from whichever worktree holds the merged profile.) Once a key is
published it can't change. If the profile changes again on the same OSM extract, that build needs a new
key: pick a rule (for example `cycling-gb-20261017-2.pmtiles`), write it into `maps/README.md`'s naming
section and bump `archives` in `maps/style/src/style.ts`.

### 6. Rebase and merge `maps/ws1-basemap`

- **Replace the Worker method with the S3 one.** Rewrite `maps/hosting/publish.sh` around `aws s3 cp`
  with `--profile r2`, keeping its guarantees: refuse an existing key (head-object), set the content
  type and cache control, then verify size and type and compare sampled byte ranges of the public URL
  with the local file, as `upload.ts` does now (header, last MiB, 24 slices). Delete `upload-worker.ts`,
  `upload.ts` and `wrangler.jsonc`; keep `cors.json`. The profile setup above goes in `maps/README.md`.
- **`docs/maps/README.md` conflicts.** The branch rewrote it from an old base, so its diff would revert
  main's later WS1.2 and WS2 text. Take main's file and re-apply only the WS1.1 changes: the status line;
  "Serving" in Architecture changed to the R2 custom domain; PR sequence item 2 to "Basemap on R2 behind
  `maps.ride-on.cc`"; the WS1.1 section rewritten as done (the extract, the bucket, why a custom domain
  rather than a Worker route, the check); and the WS1.2 table's "On R2" row.
- **`maps/README.md`** (new on the branch): list `tiles/` and `style/` in its table (they exist on main
  now) and drop the "Later workstreams add…" line; add the overlay to the keys table once published.
- **PLAN.md** Phase 7.5: "Map data" covers terrain and rebuilds too, so leave it unticked.
- Then PR and merge it yourself (`gh pr merge --merge`).

## WS2.5 batch D: verify and merge `maps/ws2-density`

What the branch does is in its `docs/maps/README.md` (WS2.5, batch D) and `cycle-travel-style.md`. In
short: London's TfL routes, paths from z11, a new `low_roads` overlay layer for lanes, streets and
railways below the basemap's zooms, and road weights and greys matched to cycle.travel.

fafc3f6's values were set from measurements but **never checked in a fresh capture**:

| Token (`maps/style/src/style.ts`) | Value | Where to check |
|---|---|---|
| `ct.trunkPale` (trunk fill; keyColour match maps trunk to it) | `#d9decd` | Colchester z12, Harwich z11 |
| `ct.majorCasingZ11` (A/B casing at z11) | `#2e2e2e` | Harwich z11, London z11 |
| `majorCasing` (A/B hairline from z12) | `#060606` | Colchester z12 |
| `minorLow` (lanes and tertiary roads below z11) | `#b9b9b9` | London z9, Harwich z10 |
| `streetZ13` (residential at z13; z12 uses `laneLow`, white with a casing from z14) | `#a9a9a9` | Putney z13, Richmond Park z13 |
| `minorStops` widths | `[10,0.9,0.3],[11,2.3,0.45],[12,2.9,1.1],[13,3.75,1.15],[15,5,2.5],[18,12,11]` | All |

Steps:

1. Put the prototype on the batch D style with local data: in
   `~/Developer/ride-on-maps-style/docs/maps/prototype`, `bun run style:local`, then `bun run serve` if
   nothing is on :8787.
2. Re-take all ten views on **one display** ([method](prototype/README.md#comparing-against-cycletravel)),
   cycle.travel and the prototype both. Screenshot colours depend on the display the Chrome window is on;
   sample new colours only on a P3 display. Never pair captures from different displays or sessions.
3. Measure with the tools in [`prototype/analysis/`](prototype/README.md#analysis-tools) (`greyruns.py`
   for street greys and widths, `abprof.py` and `lanes2.py` for A/B roads, `crop2.py` to eyeball a box).
   Fix what's off in `style.ts`, then `cd maps/style && bun run build && bun run check` (15 pass).
4. Update `docs/maps/screenshots/` and the comparison table in `README.md`: add Colchester z12 and
   rewrite rows that batch D changed (for example "our basemap has neither below z11").
5. `bun run style` (R2 URLs) before committing: the committed `style.json` must not point at
   `localhost:8787/data`. If the overlay profile changed, run the Java tests in `maps/tiles` (132 pass):
   `docker run --rm -v "$PWD":/src -v "$HOME/.m2":/root/.m2 -w /src maven:3.9-eclipse-temurin-21 mvn -B -q test`.
6. Rebase on main, PR, merge. Then publish the overlay (WS1.1 step 5).

The ten views (MapLibre zoom; cycle.travel's is one more):

| View | Centre (lat, lon) | Zoom |
|---|---|---|
| London | 51.45, −0.15 | 9 |
| London | 51.48, −0.17 | 11 |
| Putney | 51.462, −0.215 | 13 |
| Westminster | 51.5005, −0.128 | 14 |
| Richmond Park | 51.4455, −0.2665 | 13 |
| Surrey Hills | 51.245, −0.33 | 12 |
| Harwich | 51.93, 1.2 | 9, 10, 11 |
| Colchester | 51.8787, 0.964 | 12 |

URLs: `https://cycle.travel/map?lat=<lat>&lon=<lon>&zoom=<z+1>` then `capture/ct-prep.js`;
`http://localhost:8787/?v=<n>#<z>/<lat>/<lon>` then `capture/ml-prep.js`, bumping `v` after every style
rebuild so the browser can't serve a stale `style.json`. Viewport: `emulate` 1200×800 at DPR 2. Pair:
`analysis/pair2.py ct.png ml.png out.jpg 350 1`.

Known gaps after batch D, for later batches: station throats at z14 still draw every platform track;
label sizes and weights; Wrabness and Bradfield village labels missing at Harwich z11; fewer street
labels than cycle.travel at Westminster z14; fewer POI icons; no hillshade (WS1.4); the Avenue Verte
badges on the Albert Embankment; Beverley Brook not blue; fewer minor streets at z12–13.

## After that

The plan's PR sequence: WS2.6 (3× on device: use the **iPhone 17** simulator
`79662D65-4914-46BC-BA2A-510E3989498D`, never the iPhone 18 Pro one, `1F0874B6…`, which Dan uses), then
WS3.2–3.4, WS1.3–1.4, WS1.5, WS3.6 and WS4b.

## Chrome DevTools MCP

**Symptom:** every `chrome-devtools` tool fails with "Could not find DevToolsActivePort", and
reconnecting through `/mcp` doesn't help.

**Cause:** the last session ran as a background job, hosted by `~/.local/share/claude/ClaudeCode.app`
(started by `claude daemon run`). macOS privacy controls stop that app reading
`~/Library/Application Support/Google/Chrome/DevToolsActivePort` (EPERM even with the sandbox off), and
`--autoConnect` needs that file. Remote debugging is on in Chrome ("Server running at: 127.0.0.1:9222"),
but that server answers `/json/version` with 404, so `--browserUrl http://127.0.0.1:9222` doesn't work
either.

**Fix (Dan):** start the agent in a foreground terminal session (Ghostty sessions attach fine), or add
`~/.local/share/claude/ClaudeCode.app` under System Settings → Privacy & Security → Full Disk Access and
restart the daemon.

Config: `~/.mcp.json` runs `npx chrome-devtools-mcp@latest --autoConnect`, which attaches to Dan's own
Chrome. The global entry in `~/.claude.json` has no `--autoConnect` and launches a separate Chrome.

In Dan's Chrome, open your own tabs with `new_page`. Don't navigate his cycle.travel journey tab
(`/map/journey/1011079`) or his Google Maps tab. Page ids change when Chrome restarts: `list_pages` first.

## Rules carried over

- Global: never commit to `main`; branch (off `main` when the current branch has unrelated work),
  push, `gh pr create`, and in this repo merge your own PR with `gh pr merge --merge`. Commits end with
  the `Co-Authored-By` line, PR bodies with the Claude Code line.
- Work in separate worktrees (`~/Developer/ride-on-maps-*`). Don't touch the main checkout at
  `~/Developer/ride-on`: it's on Dan's `redesign/ride-window` with uncommitted work.
- cycle.travel: screenshots of the public page and reading its map state with JS are fine. Don't scrape,
  proxy or bulk-download its tiles, and don't work around its 403s, CORS or tainted canvas. Don't copy
  its POI artwork (use Maki/Temaki, CC0, or draw our own); reading colour values off its key is fine.
- Requests to the prototype's external services (Overpass) send User-Agent `ride-on-map-prototype/0.1`
  and nothing identifying Dan.
- Credentials: don't read credential files (wrangler's OAuth token, `~/.aws/credentials`), don't log in
  anywhere on Dan's behalf, don't deploy extra or test Workers.
- Downloads are untrusted: their own directory, Python run with `-I`, paths as arguments. Python here:
  `~/.local/bin/uv run -q --with pillow --with numpy --with scipy python -I <script> …`.
- zsh: don't define shell functions named `g` or `gr` (they clash with Dan's aliases). Foreground
  `sleep` is blocked; wait on background tasks instead.

## Cleanup when done

- After both PRs merge and the tiles are verified on R2: ask Dan before deleting
  `~/Developer/ride-on-maps-data` (it holds the only local copies of the archives and the OSM extract,
  which the overlay rebuild needs).
- Remove `~/Developer/ride-on-maps-style` and any worktree you created, and stop the :8787 server.
- Delete this file.

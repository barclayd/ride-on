# Ride On maps

Tiles for the cycle map (`CycleMap`, DESIGN-SYSTEM.md §6). The plan, its workstreams and the open
decisions are in [`docs/maps/README.md`](../docs/maps/README.md); the style rules are in
[`docs/maps/cycle-travel-style.md`](../docs/maps/cycle-travel-style.md).

| Path | What it is |
|---|---|
| `hosting/` | Publishing tile files to R2 (below) |
| `tiles/` | The planetiler profile that builds the cycling overlay ([README](tiles/README.md)) |
| `style/` | The style builder, glyphs and sprite ([README](style/README.md)) |

## Hosting

Tile files are single [PMTiles](https://docs.protomaps.com/pmtiles/) archives in the R2 bucket
`ride-on-maps` (location hint `weur`, Ride On's Cloudflare account), served from
`https://maps.ride-on.cc/<key>` through an R2 custom domain. MapLibre reads them with HTTP Range
requests, one tile or directory at a time.

| Key | Contents | Size | Source |
|---|---|---|---|
| `basemap-gb-20261017.pmtiles` | Protomaps basemap, z0–15, GB bbox `-8.7,49.8,1.9,60.9` | 3,005,193,777 bytes | `pmtiles extract https://build.protomaps.com/20261017.pmtiles` (tiles v4.15.2) |
| `cycling-gb-20261017.pmtiles` | Cycling overlay, z6–14 ([layers](tiles/README.md)) | 125,501,621 bytes | `maps/tiles/build.sh` on Geofabrik's 17 October 2026 GB extract with batch D's profile (PR #271); main's profile rebuilds it byte for byte |
| `terrain-gb-20261019.pmtiles` | Mapterhorn's DEM for hillshade, terrarium-encoded WebP, 512 px tiles, z0–12, GB bbox | 861,378,560 bytes | `pmtiles extract https://download.mapterhorn.com/planet.pmtiles terrain-gb-20261019.pmtiles --bbox=-8.7,49.8,1.9,60.9 --maxzoom=12` ([below](#terrain)) |
| `contours-gb-20261019.pmtiles` | OS Terrain 50's 10 m contours, layer `contours` with `ele` (metres), z11–14 | 1,035,408,114 bytes | GDAL `ogr2ogr` from OS Terrain 50's GeoPackage ([below](#terrain)) |

- **Keys are dated and immutable.** Never overwrite one: apps may be reading it, and the objects carry
  `Cache-Control: public, max-age=31536000, immutable`. Publish a new key and point the style at it, then
  delete the old one once no app version still references it. `hosting/publish.sh` refuses a key that
  already exists.
- **Naming:** `<layer>-<region>-<YYYYMMDD>.pmtiles`, where the date is the OpenStreetMap data's date:
  `basemap-gb-…`, then `cycling-gb-…` (WS1.2). `terrain-gb-…` and `contours-gb-…` (WS1.4) aren't from
  OpenStreetMap, so theirs is the date they were built. A rebuild from the same data (a changed profile,
  say) adds a counter: `cycling-gb-20261017-2.pmtiles`, then `-3`.
- **Content type** `application/vnd.pmtiles`.
- **CORS** (`hosting/cors.json`): GET and HEAD from any origin, `Range` allowed, `ETag`,
  `Content-Range`, `Content-Length` and `Accept-Ranges` exposed. The app doesn't need it; the browser
  prototype does. Apply with `wrangler r2 bucket cors set ride-on-maps --file maps/hosting/cors.json`.
- **Domain:** attached with `wrangler r2 bucket domain add ride-on-maps --domain maps.ride-on.cc
  --zone-id 41c8b77faa3495ea01f6594b00e6d34d --min-tls 1.2` (the `ride-on.cc` zone). The bucket's
  `r2.dev` URL stays off.
- **Why a custom domain and not a Worker route.** R2 custom domains serve Range requests, ETags and
  Cloudflare's cache natively, with no Worker invocations per tile. Binding a new R2 bucket to
  `ride-on-api` would also need R2 permission on the GitHub Actions deploy token, which today covers
  Workers, Queues and D1 only, or every Worker deploy would fail.
- **Cost:** storage is about $0.015 per GB-month (≈ $0.05 a month for the GB basemap); reads are Class B
  operations (10 million a month free); egress is free.

### Publishing a file

`hosting/publish.sh` uploads through R2's S3 API with the AWS CLI. The dashboard stops at 300 MB and
`wrangler r2 object put` at 300 MiB, and a Worker in the middle crawls: the first basemap upload went
through a temporary Worker into an R2 multipart upload at about 8 KB/s per part, and was abandoned after
7½ hours. The S3 endpoint took the 3 GB basemap in 3 min 43 s.

```sh
maps/hosting/publish.sh path/to/cycling-gb-YYYYMMDD.pmtiles   # key defaults to the file name
```

It checks the file is a PMTiles archive and the key is free (`aws s3 cp` overwrites silently), uploads
in 64 MB parts with the content type and cache control above, checks the stored size, type and cache
control, then compares the public URL's header, last megabyte and 24 slices across the file with the
local copy. A failed upload leaves no object; the CLI aborts its multipart upload, and R2 drops
unfinished ones after 7 days anyway (`aws s3api list-multipart-uploads` lists them).

**The `r2` AWS CLI profile (once per machine).** The script only ever runs `aws --profile r2
--endpoint-url https://3343118697a4beccae42090c4520cd29.r2.cloudflarestorage.com`. Never point it at
another profile: the `default` and the rest of `~/.aws/config` may belong to other AWS accounts.

1. Cloudflare dashboard → R2 → Manage API tokens → Create API token: **Object Read & Write**, applied
   to the `ride-on-maps` bucket only. Note the Access Key ID and Secret Access Key (shown once).
2. Create the profile:

   ```sh
   aws configure --profile r2          # the two keys; region auto; output json
   aws configure set s3.multipart_chunksize 64MB --profile r2
   aws configure set s3.max_concurrent_requests 8 --profile r2
   aws configure set request_checksum_calculation when_required --profile r2
   aws configure set response_checksum_validation when_required --profile r2
   ```

   From AWS CLI 2.23 uploads send CRC checksums by default; the last two lines limit them to what S3
   requires, as Cloudflare's R2 docs say for the CLI. If an upload fails with a checksum or
   `NotImplemented` error, check those first.

Then check the public URL:

```sh
curl -s -r 0-16383 -o /dev/null -w '%{http_code} %{size_download}\n' https://maps.ride-on.cc/<key>   # 206 16384
curl -s -r 0-6 https://maps.ride-on.cc/<key>                                                       # PMTiles
pmtiles show https://maps.ride-on.cc/<key>
```

### Making a basemap extract

```sh
brew install pmtiles
curl -s https://build-metadata.protomaps.dev/builds.json | jq -r '.[-1] | .key, .version'   # latest daily build, tiles version
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles basemap-gb-<YYYYMMDD>.pmtiles \
  --bbox=-8.7,49.8,1.9,60.9
```

The extract reads only the tiles it needs from the ~139 GB world build (a few minutes). Check the build's
tiles version against the `@protomaps/basemaps` version the style is built with
(the prototype uses 5.7.2, which reads tiles v4).

### Terrain

Hillshade and contours (WS1.4) come from two sources, both licensed for the app:

- **`terrain-gb-…`**: [Mapterhorn](https://mapterhorn.com)'s open DEM, already a PMTiles archive of
  terrarium-encoded WebP tiles (512 px). Over GB it is built from the Environment Agency's, Scottish
  Government's and Welsh Government's LiDAR (all OGL v3) and Copernicus GLO-30 at low zooms. The licence
  asks for a link to [mapterhorn.com/attribution](https://mapterhorn.com/attribution), which lists them.

  ```sh
  pmtiles extract https://download.mapterhorn.com/planet.pmtiles terrain-gb-<YYYYMMDD>.pmtiles \
    --bbox=-8.7,49.8,1.9,60.9 --maxzoom=12
  ```

  z12 is enough to shade the hills at every zoom the app shows; MapLibre overzooms it. Mapterhorn
  goes deeper, but each zoom level multiplies the size by about four.
- **`contours-gb-…`**: [OS Terrain 50](https://www.ordnancesurvey.co.uk/products/os-terrain-50)'s
  10 m contour lines (OS OpenData, OGL v3: "Contains OS data © Crown copyright and database right
  <year>"). The GeoPackage download (1.2 GB zipped, 3.5 GB unzipped) holds 1,012,647 lines in
  `contour_line`, each with its height in `property_value`. GDAL writes PMTiles directly:

  ```sh
  curl -L -o terr50_gpkg_gb.zip \
    'https://api.os.uk/downloads/v1/products/Terrain50/downloads?area=GB&format=GeoPackage&redirect'
  unzip terr50_gpkg_gb.zip                                  # Data/terr50_gb.gpkg
  docker run --rm -v "$PWD/Data":/d:ro -v "$PWD/out":/o ghcr.io/osgeo/gdal:ubuntu-small-3.11.4 \
    ogr2ogr -f PMTiles /o/contours-gb-<YYYYMMDD>.pmtiles /d/terr50_gb.gpkg \
    -dialect sqlite -sql "select geometry, cast(property_value as integer) as ele from contour_line" \
    -nln contours -dsco MINZOOM=11 -dsco MAXZOOM=14 -dsco SIMPLIFICATION=0.5
  ```

  It runs on one core and took 30 minutes on an M4 Max (157,843 tiles). z11–14 because cycle.travel's contours start
  at its z12 (our z11); MapLibre overzooms z14. OS Terrain 50 is a 50 m grid, so its contours are smooth,
  much like cycle.travel's.

Both change rarely (OS Terrain 50 is updated once a year), so they're rebuilt by hand, not by
WS1.5's monthly job.

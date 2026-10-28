# Ride On landing page

https://ride-on.cc: Astro 7 static pages with React islands (Motion for the scroll work), Biome, Bun.
Built from the Claude Design handoff "Ride On landing page" with its default variants only (system
theme, map backdrop with weather FX, scroll-list intro, inverted panel).

```
bun install
bun run dev        # copies the map style in, then astro dev
bun run check      # astro check + biome ci
bun run build      # dist/
bun run test:e2e   # Playwright smoke tests against the last build
bun run og         # re-renders public/og.png from /og (after a build)
bun run deploy     # build + wrangler deploy (CI does this on main)
```

- `src/pages/index.astro` composes the sections in `src/components/`: `.astro` for static ones,
  `.tsx` islands for anything interactive or scroll-driven
- Static sections reveal with `[data-rv]` → `[data-seen]` (an IntersectionObserver in
  `src/layouts/Base.astro`); reduced motion and no-JS show everything at once
- `scripts/copy-map.ts` copies SharedUI's `CycleMap` style, sprite and glyphs into `public/map` and
  vendors MapLibre into `public/vendor` on every build (both gitignored). Tiles come from
  https://maps.ride-on.cc
- `src/data/routes.json` holds the intro's route lines, extracted from the web design fixtures by
  `bun run routes`
- `src/worker.ts` is the `ride-on-landing` Worker: www → apex 301, security headers, immutable
  caching for `/_astro/*`, everything else from the static assets
- `src/lib/site.ts` has the site name, copy for meta tags and the Cloudflare Web Analytics token
  (the beacon only renders when it's set)

Still placeholders: the beta form (stores nothing), "Open the web app", and the Privacy and Terms
links.

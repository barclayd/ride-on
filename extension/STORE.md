# Chrome Web Store

CI builds the upload: every extension change merged to `main` produces a GitHub Release
`extension-v<version>` with `ride-on-extension-<version>-chrome.zip` attached (see README "Release").
That zip is built with `STORE_BUILD=1`, so it has no manifest `key` (the store rejects one).

**Item ID:** `ckoikfoejfcaphmdnpomgcmealkecoep`, Unlisted. 0.1.98 was submitted for review on
24 October 2026, then resubmitted the same day with new screenshots, marquee and description. It
publishes automatically once it passes. Its sign-in redirect is already in
`AUTH_CONFIG_JSON.clientRedirects`.

## First upload (manual, once)

1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-off $5 fee),
   verify the contact email.
2. **New item** → upload the zip from the latest `extension-v*` release.
3. Copy the new **item ID** and add `https://<item-id>.chromiumapp.org/ride-on` to the API's
   `AUTH_CONFIG_JSON.clientRedirects`. Without it, sign-in fails in the store build. Optional: copy
   **Package → View public key** into `key` in `wxt.config.ts`, so unpacked builds share the store
   ID and only one redirect is needed.
4. Fill in the tabs from the answers below, plus the images.
5. **Distribution → Visibility**: start with **Unlisted** or **Private** (trusted testers).
6. Submit for review. Later versions: upload the next release's zip; the version must be higher
   than the published one, which CI guarantees.

## Store listing

- **Name:** Ride On (from the manifest)
- **Summary:** Pick the best of your saved cycle.travel routes, and the best time to ride it.
- **Category:** Lifestyle → Travel
- **Language:** English (UK)
- **Description:**

  > Ride On tells you which of your saved cycle.travel routes to ride, and when to set off.
  >
  > cycle.travel is brilliant for planning routes, but it can't tell you which one suits Saturday's
  > weather. Ride On checks the hour-by-hour forecast along each route you track, at the time you'd
  > actually be riding it, and ranks them for you. No more opening a weather app for every route and
  > guessing which way the wind will blow.
  >
  > HOW IT WORKS
  > 1. Track the routes you're considering, straight from your cycle.travel Journeys page.
  > 2. Say when you can ride: tap the days that suit you over the next week, and set your time
  >    window.
  > 3. Ride On picks the best route and start time, with an estimated finish, and tells you why:
  >    temperature, wind along the route, gusts, rain and sunshine at ride time.
  > 4. Once your window has passed, tell Ride On whether you rode it, and see your next best
  >    windows: tomorrow, the same day next week, and the best of the next six days.
  >
  > WHAT YOU GET
  > • Your rides ranked with a conditions score out of 100, and a clear best pick
  > • Temperature, sky, wind and rain at a glance, with anything outside your comfort zone picked
  >   out, and the wind along the ride: where it's behind you, across you or in your face
  > • Routes that don't fit your time window or fall below your minimums are flagged, not hidden
  > • Preferences that are yours: distance and climbing, your ideal temperature and wind, how much
  >   rain and sunshine matter, and limits for cold (fixed or by month), heat, rain and gusts
  > • Your tracked routes and their best times right on cycle.travel's Journeys page
  > • Alerts for the ride you've picked: a notification if rain moves in, gusts pass your limit, it
  >   turns colder than you like, or a better time opens up
  > • A history of the rides you've logged
  > • Prefer variety? Routes that share roads with your last four weeks of rides score a little
  >   lower, fading as the ride gets older, so you're nudged towards somewhere new
  > • Forecasts from Apple Weather or the Met Office
  >
  > PRIVATE BY DESIGN
  > Ride On runs only on your cycle.travel Journeys page and uploads only the routes you track. No
  > ads, no analytics, no tracking. Ask us to delete your data at any time.
  >
  > Needs a Ride On account (sign in with Google or Apple) and a cycle.travel account with saved
  > journeys. Ride On isn't affiliated with cycle.travel.
- **Homepage URL:** https://github.com/barclayd/ride-on/tree/main/extension
- **Support URL:** https://github.com/barclayd/ride-on/issues

  These point at GitHub because https://ride-on.cc returned Cloudflare 525 (SSL handshake failed)
  on 24 October 2026. Switch them to https://ride-on.cc and https://ride-on.cc/contact once the site
  is up.

### Images

| Asset | Size | Required | Source |
| --- | --- | --- | --- |
| Store icon | 128×128 (96×96 artwork, 16px transparent padding) | yes | `store/icon-128.png` |
| Screenshots | 1280×800 (1–5) | at least 1 | `store/screenshot-1280x800.png`, then `store/screenshot-2-1280x800.png` to `-5` in order |
| Small promo tile | 440×280 | yes | `store/promo-small-440x280.png` |
| Marquee promo tile | 1400×560 | no | `store/promo-marquee-1400x560.png` |

The icon and small tile are made from the app logo (`app/RideOn.icon`) with the extension's fonts
and colours. The screenshots and the marquee's right half are the real extension (the e2e build
against a mock API, with made-up routes and rider) over a saved copy of the Journeys page: the
page with its tracked-route tiles, the popup's Rides, the alerts dialog, the popup's check-in and
next windows, then Preferences. The marquee shows the popup's Rides.

## Privacy practices

- **Single purpose:** Recommends which of your saved cycle.travel routes to ride, and when, from
  the weather forecast.
- **`identity`:** Sign-in to Ride On with Google or Apple via `chrome.identity.launchWebAuthFlow`
  (OAuth with PKCE).
- **`storage`:** Keeps the session token, ride preferences, recent rides and the latest
  recommendations on the device.
- **`unlimitedStorage`:** Cached recommendations, forecasts and ride history can pass the default
  `storage.local` quota; this stops those writes failing.
- **`scripting`:** After an update, re-injects the packaged Journeys content script into
  cycle.travel Journeys tabs that were already open. Never injects remote code.
- **`alarms`:** Ends a rider's pause at the time they picked, and syncs the pause state daily.
- **`notifications` (Chrome):** Required, not optional: the Track button on the Journeys page turns
  alerts on, and a page can't ask for the permission. Shows Web Push alerts for the picked ride.
- **`nativeMessaging` (Safari):** Links notification setup with the signed Ride On companion app.
- **Host permissions:** `https://api.ride-on.cc/*` is the extension's own backend (sign-in,
  route import, recommendations). `https://cycle.travel/*` is for the content script, which runs
  only on `/user/journeys`: it reads the user's saved journeys so they can be tracked, shows each
  route's best time to ride, and is re-injected there after an update.
- **Remote code:** No. All code ships in the package.
- **Data usage, collected:**
  - Personally identifiable information (name and email from sign-in)
  - Authentication information (session token)
  - Location (route coordinates, and which routes you rode on which dates)
  - Website content (cycle.travel journeys)

  Push subscriptions for alerts have no matching category on the form; PRIVACY.md covers them.
- **Data usage, not collected:** health, financial, personal communications, web history, user
  activity.
- **Certify all three:** not sold or transferred to third parties outside the approved use cases,
  not used for unrelated purposes, not used for creditworthiness.
- **Privacy policy URL:** https://github.com/barclayd/ride-on/blob/main/extension/PRIVACY.md

## Test instructions

No credentials (any Google or Apple account signs in). Additional instructions:

> No test account needed. 1) Open the toolbar popup and choose Continue with Google (or Apple); any
> account works. 2) Create a free account at cycle.travel, plan a route and save it as a journey.
> 3) Open https://cycle.travel/user/journeys and click "+ Track" next to a journey. The chip then
> shows its best time to ride, and the popup recommends which tracked route to ride and when from
> the forecast. Routes in Great Britain work best.

## Later: automatic publishing

Skipped for now. Once the item exists, CI can upload each release with `wxt submit`. That needs the
Chrome Web Store API credentials as repo secrets (`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`,
`CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`) and a step in the `release` job.

# App Store (Safari)

The Safari extension ships in the `Ride On` app (`safari/`), for macOS, iPhone and iPad. It uses
the main app's bundle ID, `com.danbarclay.rideon`, so the full app can later ship as an update to
the same record.

## First upload (manual, once)

1. App Store Connect → Apps → **+ New App**: platforms iOS and macOS, name **Ride On**, bundle ID
   `com.danbarclay.rideon` (register it under Certificates, Identifiers & Profiles first if it isn't
   listed), SKU `rideon`.
2. From a checkout of the latest `extension-v*` tag, signed in to Xcode with the team account:
   `cd extension && bun install && bun run safari:archive`. Automatic signing registers
   `com.danbarclay.rideon.Extension` on first use.
3. Once processed, both builds appear in TestFlight. Add yourself as an internal tester.

## Listing

- **Category:** Health & Fitness. **Price:** free.
- **Description:** reuse the Chrome listing, and say it needs a free cycle.travel account and works
  in Safari. Review notes: "Safari extension. Open Settings → Apps → Safari → Extensions (iOS) or
  Safari → Settings → Extensions (macOS), turn on Ride On, then sign in from its toolbar button on
  cycle.travel." Add a demo account if review asks.
- **Privacy:** the same data as the Chrome answers above (contact info and identifiers from sign-in,
  location from routes, user content from cycle.travel journeys). None is used for tracking.
  Privacy policy: [PRIVACY.md](PRIVACY.md).
- **Encryption:** `ITSAppUsesNonExemptEncryption` is `NO` (HTTPS only).

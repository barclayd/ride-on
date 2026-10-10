# Chrome Web Store

CI builds the upload: every extension change merged to `main` produces a GitHub Release
`extension-v<version>` with `ride-on-extension-<version>-chrome.zip` attached (see README "Release").
That zip is built with `STORE_BUILD=1`, so it has no manifest `key` (the store rejects one).

## First upload (manual, once)

1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-off $5 fee),
   verify the contact email.
2. **New item** → upload the zip from the latest `extension-v*` release.
3. Copy the new **item ID** and add `https://<item-id>.chromiumapp.org/ride-on` to the API's
   `AUTH_CONFIG_JSON.clientRedirects`. Without it, sign-in fails in the store build. Optional: copy
   **Package → View public key** into `key` in `wxt.config.ts`, so unpacked builds share the store
   ID and only one redirect is needed.
4. Fill in the tabs from the answers below, plus the images.
5. **Distribution → Visibility**: start with **Unlisted** or **Private** (trusted testers). Before
   making it public, move the session token out of `storage.local` (see the `ponytail:` note in
   `lib/api.ts`).
6. Submit for review. Later versions: upload the next release's zip; the version must be higher
   than the published one, which CI guarantees.

## Store listing

- **Name:** Ride On (from the manifest)
- **Summary:** Pick the best of your saved cycle.travel routes, and the best time to ride it.
- **Category:** Lifestyle → Travel
- **Language:** English (UK)
- **Description:**

  > Ride On picks the best of your saved cycle.travel routes, and the best time to ride it.
  >
  > Choose the days and the time you have, and Ride On scores every route you track against the
  > hour-by-hour forecast: wind along the route (favouring tailwinds), temperature, rain and
  > sunshine, plus the distance and climbing you like. The best ride and start time come first.
  >
  > • Popup: your ranked rides, when you can ride, and your preferences
  > • On cycle.travel's Journeys page: track routes and see each one's best time at a glance
  > • Forecasts from Apple Weather or the Met Office
  >
  > Needs a Ride On account (sign in with Google or Apple) and a cycle.travel account with
  > saved journeys. Not affiliated with cycle.travel.

### Images

| Asset | Size | Required | Source |
| --- | --- | --- | --- |
| Store icon | 128×128 (96×96 artwork, 16px transparent padding) | yes | `store/icon-128.png` |
| Screenshots | 1280×800 (1–5) | at least 1 | Popup over the Journeys page, synthetic routes only |
| Small promo tile | 440×280 | yes | `store/promo-small-440x280.png` |
| Marquee promo tile | 1400×560 | no | `store/promo-marquee-1400x560.png` |

The icon and tiles are made from the app logo (`app/RideOn.icon`) with the extension's fonts and
colours.

`bun run test:e2e` saves popup and page screenshots with synthetic data to `test-results/`, a
starting point for the screenshots. Don't use real journey names.

## Privacy practices

- **Single purpose:** Recommends which of your saved cycle.travel routes to ride, and when, from
  the weather forecast.
- **`identity`:** Sign-in to Ride On with Google or Apple via `chrome.identity.launchWebAuthFlow`
  (OAuth with PKCE).
- **`storage`:** Keeps the session token, ride preferences and the latest recommendations on the
  device.
- **Host permission `https://api.ride-on.cc/*`:** The extension's own backend: imports tracked
  routes and returns weather-based ride recommendations.
- **Content script on `https://cycle.travel/user/journeys*`:** Reads the user's saved journeys so
  they can be tracked, and shows each route's best time to ride on that page. Runs on no other page.
- **Remote code:** No. All code ships in the package.
- **Data usage, collected:**
  - Personally identifiable information (name and email from sign-in)
  - Authentication information (session token)
  - Location (route coordinates)
  - Website content (cycle.travel journeys)
- **Data usage, not collected:** health, financial, personal communications, web history, user
  activity.
- **Certify all three:** not sold or transferred to third parties outside the approved use cases,
  not used for unrelated purposes, not used for creditworthiness.
- **Privacy policy URL:** https://github.com/barclayd/ride-on/blob/main/extension/PRIVACY.md

## Later: automatic publishing

Skipped for now. Once the item exists, CI can upload each release with `wxt submit`. That needs the
Chrome Web Store API credentials as repo secrets (`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`,
`CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`) and a step in the `release` job.

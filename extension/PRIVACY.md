# Ride On for cycle.travel — privacy policy

_Last updated: 10 October 2026_

Ride On is a Chrome extension that recommends which of your saved cycle.travel routes to ride, and
when, from the weather forecast. It talks to one service, the Ride On API at `https://api.ride-on.cc`.

## What it collects and why

- **Account.** You sign in with Google or Apple. The Ride On API receives your name and email
  address (OpenID `email`/`profile` scopes only) to create and identify your account.
- **Routes.** On `cycle.travel/user/journeys`, the extension reads your saved journeys. Each journey
  you track is sent to the Ride On API as GPX: its name, coordinates and elevation.
- **Preferences.** Your ride settings (such as distance, climbing and forecast provider) are saved
  to your Ride On account; a few display settings stay in your browser only.

To score your routes, the Ride On API sends route coordinates and times to its weather providers
(Apple Weather and the Met Office). The extension doesn't contact them directly.

## Stored in your browser

Your session token is kept in the extension's private storage, readable only by its background
worker. Settings and the latest recommendations live in Chrome's extension storage
(`chrome.storage.local`). All of it stays on your device; signing out removes the session token.

## What it doesn't do

No ads, analytics or tracking. Your data isn't sold or shared beyond what's described above, isn't
used for anything unrelated to recommending rides, and isn't used to decide creditworthiness or
for lending. The extension runs only on `cycle.travel/user/journeys` and reads nothing else you browse.

## Deleting your data

To delete your Ride On account and its routes, open an issue at
https://github.com/barclayd/ride-on/issues asking for deletion (don't include personal details there;
we'll follow up through your sign-in email).

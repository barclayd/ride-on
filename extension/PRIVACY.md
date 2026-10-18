# Ride On for cycle.travel — privacy policy

_Last updated: 18 October 2026_

Ride On is a Chrome and Safari extension that recommends which of your saved cycle.travel routes
to ride, and when, from the weather forecast. It uses the Ride On API at `https://api.ride-on.cc`.

## What it collects and why

- **Account.** You sign in with Google or Apple. The Ride On API receives your name and email
  address (OpenID `email`/`profile` scopes only) to create and identify your account.
- **Routes.** On `cycle.travel/user/journeys`, the extension reads your saved journeys. Each journey
  you track is sent to the Ride On API as GPX: its name, coordinates and elevation.
- **Preferences.** Your ride settings (such as distance, climbing and forecast provider) are saved
  to your Ride On account; a few display settings stay in your browser only.
- **Rides.** When you tell Ride On you rode a route, the date, the route and the plan it recommended
  (start, finish, forecast conditions and when the forecast was made) are saved to your Ride On
  account. They're used to show your History and, if you prefer variety, to score routes that share
  roads with recent rides a little lower. Remove a ride from History at any time.
- **Tracked departures and alerts.** Pinning a departure saves that plan and its original
  conditions to your account, so Ride On can check for changes using your saved preferences.
  Tracking, notification history and pauses are shared across your signed-in devices.
- **Optional notifications.** When you enable notifications, Ride On saves an installation
  identifier and an Apple push token or Chrome push subscription to deliver alerts to that
  device. Safari uses Apple Push Notification service through the Ride On companion app;
  Chrome uses Google's push service with encrypted message contents. Apple receives the
  notification contents needed for delivery. These services receive the device routing
  information needed to deliver messages. Turning notifications off or signing out requests
  removal of that installation's registration.

To score your routes, the Ride On API sends route coordinates and times to its weather providers
(Apple Weather and the Met Office). The extension doesn't contact them directly.

## Stored on your device

Your session token and notification registration are kept in the extension's private storage,
separate from webpage data. Settings, recent rides and recommendations, and cached tracking and
pause status are kept in extension storage. The account's tracked plan and pause also live on
the server. While you're signed in, Safari's extension shares your session and email address with
the Ride On companion app on the same device, in their private Apple Keychain group, so the app
can show who is signed in, manage notifications and sign you out. The app's notification switches
are kept there too. Signing out in either removes the shared session and email and disables the
notification link. Notification links contain a plan identifier, not credentials;
the browser asks you to sign in before showing the plan.

## What it doesn't do

No ads, analytics or tracking. Your data isn't sold or shared beyond what's described above, isn't
used for anything unrelated to recommending rides, and isn't used to decide creditworthiness or
for lending. The extension runs only on `cycle.travel/user/journeys` and reads nothing else you browse.

## Deleting your data

To delete your Ride On account, its routes and rides, open an issue at
https://github.com/barclayd/ride-on/issues asking for deletion (don't include personal details there;
we'll follow up through your sign-in email).

# Scheduled ride monitoring and push delivery

API v0.30.0 implements the backend policy agreed on 16 October 2026. It extends the [chosen-ride tracking API](ride-tracking-api.md); the accepted baseline, fixed departure, original comparison routes/dates/window, and scoring algorithm (`comfort-v0.17`) are unchanged. The Safari companion app and Chrome extension now integrate permission, registration, presentation and browser navigation; the full SwiftUI app remains a separate client integration.

## Agreed decisions

Except while the account is paused, all active tracked rides, including existing records and accounts without devices, receive automatic assessments until their accepted departure. Stopping, replacing or erasing a plan cancels pending work. Tracking history still remains active until estimated finish, as before; monitoring ends at departure.

| Event | Rule | Ordinary three-hour gap |
| --- | --- | --- |
| Conditions score | At least ±5 points, in either direction | Applies |
| New minimum breach | A previously satisfied configured minimum now fails; combine simultaneous breaches | Bypassed |
| Recovery of a minimum | Report each recovered minimum and remaining failures; unknown data is not recovery | Applies |
| Better option | Fully assessed best route/departure in the original scope, meeting all minimums, ≥5 Conditions points better **or** resolving the tracked ride's failed minimums | Applies |
| Evening summary | 19:00 the evening before, in the tracked ride's time zone, even unchanged; skip plans first tracked after that time | Bypassed |
| Assessment unavailable | One notice after one hour without a current assessment, when departure is within 24 hours | Bypassed |
| Assessment available again | One recovery after a delivered availability notice, combined with current qualifying changes | Bypassed |

There are **no quiet hours**. A qualifying best option may be the same ride at another departure or another shortlisted route; copy names the new best option. Incomplete comparison coverage cannot establish a new best option. A small ranking shuffle alone is silent. The plan never switches automatically.

The first score comparison uses the accepted Conditions score. After either push service accepts a notification containing current conditions, its score becomes the separate notification reference: 80 → 74 alerts, 72 stays quiet, 68 alerts once the gap permits. The original accepted baseline remains immutable. The reference also retains notified minimum failures and the suggested option. Separately observed minimum transitions detect a fresh breach even when an intervening recovery was held by the cooldown. Simultaneous events combine into one message and reset the reference to the conditions that message contains. The cooldown is measured from the first transport acceptance, not queueing or a failed attempt. APNs acceptance means Apple accepted delivery, not that a device displayed it or the user read it.

Preference, course, history, scoring-version and weather-source changes quietly restart forecast comparisons. They do not masquerade as weather changes. The original baseline and actual delivery history remain unchanged. Becoming assessable after unknown minimums does not itself prove a limit was crossed.

Pending changes are recomputed against the current assessment. Withdrawn changes are cancelled; newer assessments supersede obsolete unsent deliveries. A retry is allowed only while the plan is active, before departure, with the same inputs, current assessment and current device registration. A push already accepted by Apple cannot be recalled if the rider subsequently stops the plan.

At summary time, an unavailable assessment produces an explicit availability message with the last successful check when known. It counts as the outage notice; recovery follows once current assessments resume. No-device accounts keep their assessment current but cannot receive pushes or advance the last-notified reference. An eligible summary may retry after 19:00 until departure, with current content; it is never replayed after departure. Outage/summary state only counts as notified after a push-service acceptance.

### Account pauses

API v0.34.0 implements the [pause contract](api.md#pause). An account pause
suppresses **every** monitoring alert: score changes, minimum breaches/recoveries,
better options, evening summaries, forecast outages and recovery notices. It
cancels all unsent device deliveries, including the remaining devices of a
partially accepted event. An APNs request already in flight or accepted cannot be
recalled. Pause/resume writes revoke monitor leases so an old job cannot publish
an alert or overwrite the reference after the account changes state.

Paused jobs check account state and departure, then stop before any assessment or
weather request. The accepted baseline and notification reference remain intact,
and the tracked plan stays active. Monitoring still ends at departure. The
existing 15-minute dispatcher continues checking due plans; the consumer resolves
return dates from the current saved profile zone, so automatic resume needs no
client, extra timer, or cleanup write.

Both explicit resume and dated expiry leave a durable quiet-rebase marker. The
first successful current assessment becomes the new notification reference and
sends nothing; if weather is unavailable, this marker survives until a successful
assessment. Pending breaches and outage/recovery state restart quietly, while
actual delivery history and the last accepted notification time remain intact.
A summary whose time has passed by that first assessment is marked handled and
never replayed. Later summaries and new weather changes follow the ordinary rules.
This also applies when pause and resume both happen between scheduled checks,
and to plans first tracked during a pause.

Pause is independent of preference `version`, so it does not use a preference
change to trigger this rebase. Explicit forecast and manual refresh endpoints
remain available; clients stop their automatic requests while paused.

## Scheduling, reliability and bounds

A Cloudflare Cron Trigger runs every 15 minutes and dispatches due plan IDs through `ride-monitoring`. Queue delivery is at least once. D1 provides dispatcher claims, five-minute monitor leases, the existing refresh publication guard, notification records and independent device delivery records. Duplicate queue jobs cannot send concurrently for the same plan. Expired claims and leases recover lost or exhausted queue attempts on a later tick.

The dispatcher processes up to 500 due plans per tick in indexed pages of 50. The consumer runs one plan per message, with concurrency two. This is an initial bounded operating configuration, not an unlimited throughput claim: monitor backlog age and increase capacity before a sustained backlog exceeds a tick. Processing does not depend on whether an account has registered devices.

Forecast retrieval preserves the existing 3/6/12-hour policy for today/tomorrow/later, with earlier provider expiry/model-age constraints. Checks reuse valid cached weather. Local midnight can tighten the age limit. Current saved input revisions are checked every tick; input changes and manual refreshes are evaluated at the next tick. Failed assessments retry at subsequent ticks. An ordinary delayed alert is evaluated again after the gap; stale weather is never sent as current.

There is no exact-time delivery guarantee: scheduled checks, queue time, provider response time and APNs delivery add latency. In particular, 19:00 means the first eligible tick/consumer run at or after that local time.

Each event has a per-device APNs ID, a plan collapse ID and an expiry no later than its assessment or departure. Confirmed accepted devices do not repeat on another device's retry. Retry delays start at 15 minutes and back off to one hour. Network failures, 429, 5xx and credential failures retry within validity; terminal payload errors are retained as failed. Invalid/unregistered tokens are retired only if their registration version and Apple's invalidation timestamp still match. Tokens rotated during a send are protected. Token deletion retains delivery audit counts; plan erasure removes its events and deliveries.

A network failure after Apple accepted a request is ambiguous. Stable APNs IDs and collapse IDs reduce duplicates, but neither APNs nor this outbox promises exactly-once device display. Superseding an event may cancel its outstanding device attempts; only current, useful information remains eligible.

Events are compact: they store the decision, presentation and assessment ID rather than another full forecast snapshot. They follow the plan's explicit-erasure retention policy. Device registrations are capped at 20 per account. Provider JWTs are shared in D1, refreshed after 50 minutes, and cleaned up after a day. Private signing keys remain Worker secrets. Do not log APNs tokens, authorization headers or payloads.

## Device API

All endpoints use the existing authenticated owner session and `Cache-Control: no-store`. Device tokens are request-body fields, never path parameters or response fields. The fixed allowed topic is `com.danbarclay.rideon`.

```http
PUT /push-devices/{installationUUID}
Content-Type: application/json

{
  "token": "<APNs hexadecimal token>",
  "environment": "sandbox",
  "topic": "com.danbarclay.rideon",
  "platform": "ios"
}
```

`environment` is `sandbox` or `production`; `platform` is `ios` or `macos`. Persist a random installation UUID locally, then reuse it for token rotation. Register after notification permission and successful account authentication. Registration is idempotent for the same token; replacing a token invalidates pending attempts for its old version. The response contains public device metadata and `deliveryConfigured` for that environment. This flag is configuration readiness, not proof of successful delivery.

A conflicting installation/token belonging to another registration, or a 21st device, returns `409 DEVICE_REGISTRATION_CONFLICT`. Unregister the old installation while still signed in before signing out or changing accounts. The backend does not transfer another account's device through registration.

- `GET /push-devices` returns owner-scoped public device metadata and capabilities.
- `DELETE /push-devices/{installationUUID}` idempotently unregisters the owner's installation and cancels pending deliveries. Delete it on sign-out or notification opt-out.
- `GET /tracked-rides/{id}/notifications?limit=20&cursor=...` returns paginated event history: `id`, `createdAt`, `expiresAt`, `acceptedAt`, `status`, `devicesAccepted`, `devicesPending` and `decision`. Limit 1–50; use the returned opaque cursor. Foreign plans return 404. This read does not fetch weather or send pushes.

Event statuses are `pending`, `accepted`, `superseded`, `cancelled`, or `failed`. `accepted` means at least one push-service acceptance; other devices may still be pending. Decision fields include reasons, score/delta, new/recovered/remaining minimums, the qualifying alternative and last-success time. Per-device attempts and transport reason codes remain operational D1 records.

An Apple alert has standard sound and thread grouping by plan. No critical/time-sensitive entitlement is required. Custom payload fields:

```json
{
  "schemaVersion": 1,
  "notificationId": "<event UUID>",
  "trackedRideId": "<plan UUID>",
  "departureAt": "2026-10-17T08:00:00.000Z",
  "reasons": ["score_worsened", "better_option"]
}
```

On a tap, authenticate and fetch `/tracked-rides/{trackedRideId}`. Treat the push as a prompt to read the current plan, not authoritative current weather. Handle stopped, erased and already-departed plans. The app must combine notification permission, successful device registration and the server capabilities before promising push delivery.

## Deployment and operation

Migration `0011` enrolls existing active plans. Migration `0016` adds independent account pauses and the durable resume marker; apply it before deploying v0.34.0. The Worker has both scheduled and queue entry points alongside its unchanged HTTP routing. Set `RIDE_MONITORING` to `disabled` to pause new monitoring/sends; return it to `enabled` to resume. App capability flags reflect this switch. `notifications` also requires at least one configured APNs environment; individual registration reports the requested environment's readiness.

Both queues were provisioned on 16 October 2026. For a new environment, create them once before deploying the binding (the deployment identity needs Queues permission):

```sh
bunx wrangler queues create ride-monitoring
bunx wrangler queues create ride-monitoring-failed
```

The normal main deployment applies migration `0011` before deploying the Worker. `ride-monitoring-failed` retains exhausted queue messages for diagnosis; D1's due-work records recover those plans even without manual replay. Watch Cron success, queue backlog/oldest message, dead letters, `ride_monitor_failed`, overdue `tracking_monitors.next_due_at`, and pending/rejected `push_deliveries.reason`. Do not put tokens into diagnostic output.

Configure **optional** secret `APNS_CONFIG_JSON` separately from WeatherKit credentials. Provide each environment's APNs-enabled team/key and PKCS#8 PEM private key:

```json
{
  "sandbox": { "teamId": "<10-character team>", "keyId": "<10-character key>", "privateKey": "<PKCS#8 PEM>" },
  "production": { "teamId": "<10-character team>", "keyId": "<10-character key>", "privateKey": "<PKCS#8 PEM>" }
}
```

Either environment may be omitted. Use `wrangler secret put APNS_CONFIG_JSON`; never commit a real value. Missing/invalid configuration leaves assessments running and reports notification delivery unconfigured. WeatherKit credentials do not establish APNs authorization. Current production secret metadata was checked on 16 October: the APNs secret was not yet configured. App registration and a real device smoke test remain prerequisites for live alert verification.

The sender uses native Workers `fetch`; `node:http2` is not supported for this purpose. The [Workers runtime issue](https://github.com/cloudflare/workerd/issues/4841) records the local macOS HTTP/2 limitation for APNs while deployed Workers support this fetch path. Local integration tests mock the HTTP boundary and do not prove device delivery. Apple documents [request construction](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [responses and retry handling](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns), and [provider authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).

## Verification

`bun run check` covers deterministic policy scenarios and real Workers/D1/KV integration with synthetic weather and APNs responses: cooldown/reset thresholds, breaches/recoveries, unknown data, quiet rebases, best options, summaries and DST, outage recovery, authentication/ownership, token rotation, duplicate jobs, retry isolation, lifecycle cancellation and poison messages. Pause scenarios cover cancellation, skipped weather, preserved baselines, quiet explicit/cron resume, missed summaries, outage recovery, plans created while paused, and concurrent weather/APNs requests. `bun run build:check` validates the deployable bundle and bindings. No live weather quota or real user pushes are used by tests.


## Chrome and Safari delivery (API v0.37.0)

Both clients use the same monitoring policy and durable event. A successful send to either transport advances the notification reference once; each installation retries independently. No browser runs a separate forecast scheduler. Browser delivery does not change scoring or the agreed alert thresholds.

Chrome desktop 121+ receives encrypted Web Push in the extension service worker and presents a system notification. Permission is optional and requested only from **Preferences → Enable notifications**. Chrome need not have a Ride On page open; a fully quit browser or disabled OS notifications may delay/prevent presentation. Subscription and installation data live in the extension's private IndexedDB. Token changes/versioning, expired endpoints, subscription-change events, reconnection, permission removal and sign-out are handled. The extension suppresses expired/duplicate pushes and checks account/plan lifecycle without requesting weather. During a temporary API outage it can show the still-valid encrypted message; notification taps always load current data.

Safari on Mac, iPhone and iPad uses the signed Ride On containing app and APNs, not a website subscription. Enable in the extension, open the companion, then press **Enable notifications** to request system permission. The native extension and app share the installation and account session in their private Keychain access group; tokens never appear in a URL, content-script message or public storage. One native installation links to one Safari account at a time; disable it before linking another profile/account. The companion registers with Apple again when foregrounded, handles token changes, and unregisters from the backend on disable/sign-out. It reports setup/blocked/server-unconfigured states rather than claiming delivery is ready.

The bell now pins the chosen recommendation's exact departure through `/tracked-rides`. Replacing a plan requires confirmation and the current tracking version. A conflict reloads rather than automatically overwriting another device's choice. Removing a route from the shortlist does not stop its tracked departure. The account's tracked ride remains visible in both browser surfaces even if its route is absent from the shortlist. Tracking works without enabling notifications.

Both transports open `https://api.ride-on.cc/notifications/open#ride=<plan UUID>`. The companion uses the device's default browser. This page uses the existing HttpOnly browser session, offers Apple/Google sign-in when needed, and fetches the current owner-scoped plan and alert history. It labels saved/stale assessments, original-baseline deltas, minimum failures, assessed alternatives, and stopped/replaced/departed plans. An erased or other-account plan reveals no details. The page uses text-only dynamic rendering, a restrictive CSP and no-referrer policy. No credentials travel in the link.

### Browser registration and capabilities

`GET /push-devices/config` returns `webPush: {configured, publicKey}`, `apns: {sandbox, production}` and `automaticChecks`. Only the public VAPID key is exposed. Tracking/device capabilities add `notificationTransports: {apns, webPush}`; the legacy `notifications` flag retains its APNs meaning.

```json
{
  "transport": "web_push",
  "platform": "chrome",
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/<subscription>",
    "expirationTime": null,
    "keys": { "p256dh": "<base64url P-256 public key>", "auth": "<base64url 16-byte secret>" }
  }
}
```

Send that body to the same authenticated `PUT /push-devices/{installationUUID}`. Endpoints are limited to HTTPS Google FCM `/fcm/send/` or `/wp/` URLs; redirects, credentials, query strings and arbitrary hosts are rejected. Key lengths and the elliptic-curve point are validated. Subscription keys and endpoints never appear in registration/list responses. A changed subscription increments the installation version and cancels old pending attempts. A 404/410 retires only that registration version; transient provider failures retry within the original expiry.

Native registrations accept optional `scope: "tracked_rides" | "all"` (legacy default `all`). The Safari companion uses `tracked_rides`; Chrome registrations always have that scope. Existing full-app installations retain their Strava notifications. Browser clients receive the agreed ride-monitoring alerts, not unrelated Strava prompts whose review screen is in the full app.

### Configuration and verification

Apply migration `0018` before deploying. It preserves existing APNs registrations and Strava delivery records while adding transport/subscription/scope fields. Set optional Worker secret `WEB_PUSH_CONFIG_JSON` to `{ "subject": "https://api.ride-on.cc", "publicKey": "<base64url uncompressed P-256 point>", "privateKey": "<base64url 32-byte scalar>" }`. Generate this VAPID pair once and keep it stable. Changing it requires Chrome subscriptions to reconnect. Never commit the private key or log subscription bodies.

Safari needs the separate `APNS_CONFIG_JSON` described above. Its Xcode targets share the `$(AppIdentifierPrefix)com.danbarclay.rideon.notifications` Keychain group. Debug uses the development APNs entitlement and `sandbox` registration; Release uses production for both. If exporting with development signing, use Debug or override **both** `APS_ENVIRONMENT=development` and `PUSH_ENVIRONMENT=sandbox`. When incorporating the extension into the full app, preserve this group/service/installation and move the registration/delegate code; do not register a second native installation for the same app.

Automated verification includes independent RFC 8291/8188 payload decryption and VAPID signature validation; endpoint/key/owner validation; migration preservation with foreign keys enabled; mixed APNs/Web Push retries; and browser tests for explicit tracking replacement, stale versions and the signed-in/signed-out landing page. Real device receipt/click tests require production VAPID/APNs configuration and installed signed clients; mocks and successful builds do not prove live delivery.

Platform references: [Chrome extension Web Push](https://developer.chrome.com/docs/extensions/how-to/integrate/web-push) and [Safari native messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension).

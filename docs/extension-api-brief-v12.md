# Extension API brief v12: notification switches for each device

Against API **0.38.0**, algorithm **comfort-v0.17**. Additive: no scoring, ranking
or algorithm-version change.

The Safari companion app for macOS is being redesigned (handoff
`design_handoff_ride_on_safari_v1`, option 1c). It becomes a settings window
with a Notifications pane that has three switches:

| Switch | Detail line in the app | Default |
| --- | --- | --- |
| `rideAlerts` | When the forecast for your tracked ride changes | on |
| `finalForecast` | 18:00 the evening before your ride | on |
| `sound` | Play a sound with each alert | off |

The switches belong to **this Mac**, not the account: a rider can keep alerts on
their phone and silence them on their Mac. The API sends every alert, so the app
can't apply the switches itself:

- **Can't skip an alert:** macOS shows an APNs alert as soon as it arrives. An app
  can't drop a remote notification on macOS: the filtering entitlement is
  iOS-only.
- **Can't silence it:** `monitoring/message.ts` always sets `aps.sound` to
  `default`.

Until the API supports these switches, the app stores them on the Mac and doesn't
send them. `PUT /push-devices/{id}` is a strict object and rejects unknown fields.
This brief makes the switches work.

## 1. `alerts` on device registration

`PUT /push-devices/{installationUUID}` gains an optional `alerts` field on the native
(APNs) body:

```json
{
  "token": "…",
  "environment": "production",
  "topic": "com.danbarclay.rideon",
  "platform": "macos",
  "scope": "tracked_rides",
  "alerts": { "rideAlerts": true, "finalForecast": true, "sound": false }
}
```

- **Absent `alerts`:** all three are `true`. That matches today's behaviour, so
  the iOS app and older Safari builds don't change. (The app defaults Sound to off,
  but it always sends its choice once §4 is live.)
- **Validation:** `alerts` is a strict object, and all three booleans are required.
  All three `false` is allowed: the device stays registered but receives nothing.
- **Re-registering:** a `PUT` without `alerts` keeps the stored values. Don't reset
  them, because token rotation re-sends the registration.
- **Web Push:** leave the Chrome body as it is. Chrome has no such switches yet.

## 2. Change the switches without re-registering

`PATCH /push-devices/{installationUUID}` with `{ "alerts": { … } }`:

- **Body:** a strict object, with the same `alerts` rules as §1.
- **Ownership:** owner-scoped. Another owner's device, or an unknown one, returns
  `404`.
- **Response:** the same `device` object as the `PUT`.
- **Device version:** don't bump it. Pending deliveries shouldn't be cancelled
  because a switch changed. §3 applies at send time instead.

The app calls this whenever a switch changes after the Mac is registered.

## 3. What each switch sends

Apply the switches **for each device**, when a delivery is fanned out to it:

| Switch | Reasons it gates |
| --- | --- |
| `rideAlerts` | Every reason except `evening_summary`: score changes, minimum breaches and recoveries, `rain_likely`, `feels_cold`, `better_option`, `unavailable` and `available_again` |
| `finalForecast` | `evening_summary` |
| `sound` | Omit `aps.sound` for this device. Leave `thread-id` and everything else as it is. |

- **Combined alerts:** monitoring combines reasons into one message. Send the
  message to a device if **any** of its reasons is on for that device, and keep
  the copy as it is. Proposal: if that's awkward in the fan-out, gate on the
  message's leading reason instead. Either way, say which in the docs.
- **Per-ride triggers:** unchanged. A ride's `alerts.triggers` (v0.38.0) decide
  whether a reason exists at all. The device switches only decide which devices
  get it.
- **Account pause:** unchanged. It suppresses everything, as today.
- **No device eligible:** if every device is switched off for an event, treat it
  as handled quietly. Advance the notification reference as if it had been
  accepted. Otherwise, turning Ride alerts back on would replay old changes.
  This is the same rule as a per-ride trigger that's off. A device that is
  switched on but fails delivery behaves as it does today.

## 4. Capabilities

`GET /push-devices/config` gains:

```json
"deviceAlerts": true
```

The app sends `alerts` in the `PUT` and calls the `PATCH` only when this is
`true`. Ship it in the same release as §1–§3, never before.

`GET /push-devices` returns each device's `alerts`. Devices registered before this
change read as all `true`.

## 5. Unchanged

- **Monitoring:** monitoring policy, cooldowns and the notification reference, apart
  from the §3 no-eligible-device rule.
- **Scoring:** `POST /recommendations` and scoring.
- **Chrome:** Web Push registration and Chrome delivery.
- **Account details:** `/auth/me` already returns the signed-in email, which the app
  shows in its sidebar. No change is needed there.

## 6. Tests, docs and version

- **Version:** API **0.39.0**. The algorithm stays `comfort-v0.17`.
- **Migration:** `0020_device_alerts.sql` adds three columns to `push_devices`,
  each `INTEGER NOT NULL DEFAULT 1`.
- **Docs:** update `docs/api.md` and `docs/ride-monitoring.md` (the device
  registration body, the `PATCH`, the capability and the gating table).
- **Tests:**
  - **Validation:** `alerts` absent means all on, unknown keys return 400, and a
    re-`PUT` without `alerts` keeps the stored values.
  - **`PATCH`:** it round-trips, and another owner's device returns 404.
  - **`rideAlerts` off:** the device gets the evening summary but no score or
    breach alerts. A second device that's still on gets everything.
  - **`finalForecast` off:** the evening summary is skipped, and ride alerts still
    send.
  - **`sound` off:** the APNs payload has no `aps.sound`.
  - **No eligible device:** the event is handled quietly, and turning the switch
    back on doesn't replay it.
  - **Capability:** `GET /push-devices/config` includes `deviceAlerts: true`.

## 7. Safari app follow-up

The Mac app redesign (branch `extension/safari-app-redesign`) already:

- stores the switches on the Mac, in the keychain group it shares with the
  extension;
- reads `deviceAlerts` from `GET /push-devices/config`;
- once that's `true`, sends `alerts` in the registration `PUT` and calls the
  `PATCH` when a switch changes.

Once the API ships, the app needs no further change.

## Open questions

1. **Combined messages** (§3): send when any reason is on, or gate on the leading
   reason?
2. **Outage notices:** should `unavailable` and `available_again` follow Ride
   alerts (proposed), or always send?

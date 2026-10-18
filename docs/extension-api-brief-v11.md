# Extension API brief v11: choose what a tracked ride alerts on

Against API **0.37.0**, algorithm **comfort-v0.17**. Additive: no scoring, ranking
or algorithm-version change.

Design handoff v10 (29c) puts a dialog in front of the bell. When a rider turns on
alerts for a ride, they choose what to hear about:

| Switch | Label in the extension | Rule (from the design) |
| --- | --- | --- |
| `rain` | Rain becomes likely | Any ride hour reaches a 60% chance of rain |
| `wind` | Gusts pass your {n} km/h limit | Gusts above `minimumStandards.maximumGustKph` |
| `cold` | It feels colder than your {n}° minimum | Feels like below `temperature.comfortMinC` |
| `betterTime` | A better time or day opens up | A higher-scoring time or day appears |

The extension hides a switch when its limit isn't set: no `maximumGustKph` means no
wind switch, and no `comfortMinC` means no cold switch. At least one switch must be
on.

The dialog also says: "Plus the final forecast at **18:00** on {the evening before}.
Alerts stop at {departure} when you leave." Today the API sends the evening summary
at **19:00**.

The extension ships the dialog now. Until the API supports triggers, it keeps the
choices on the device and doesn't send them, because `POST /tracked-rides` is a
strict object and rejects unknown fields. So the switches don't change any alerts
yet. This brief makes them work.

## 1. `alerts` on `POST /tracked-rides`

The body gains an optional field:

```json
{
  "recommendationRef": "…",
  "expectedTrackingVersion": 4,
  "replaceTrackedRideId": null,
  "alerts": {
    "triggers": { "rain": true, "wind": false, "cold": true, "betterTime": true }
  }
}
```

- **Absent `alerts`:** every trigger on. That's what the iOS app and older
  extensions send today, and their behaviour shouldn't change.
- **Validation:**
  - `triggers` is a strict object with all four booleans required.
  - Reject all four `false` with `400 VALIDATION`.
- **Limits not set:** a trigger whose limit isn't set (wind, cold) is accepted as
  `true` but never fires. Don't reject it: the rider can add the limit later in
  Preferences.

## 2. `alerts` on the tracked ride

Every tracked ride the API returns (`GET /tracked-rides/{id}` and the `POST`
response) gains:

```json
"alerts": { "triggers": { "rain": true, "wind": true, "cold": true, "betterTime": true } }
```

Rides created before this change read as all `true`. The extension copies these
into its own per-route memory, so a choice made in Chrome shows in Safari and on
the Journeys page.

## 3. Capabilities

`GET /tracked-rides` already returns `capabilities` (from
`monitoringCapabilities`). Add:

```json
"alertTriggers": true,
"finalForecastLocalTime": "18:00"
```

- **`alertTriggers`:** the extension sends `alerts` only when this is `true`. Ship
  it in the same release as §1, never before.
- **`finalForecastLocalTime`:** the local time of the evening summary on the day
  before departure. The dialog shows it, and leaves the sentence out once that time
  has passed. Without it, the extension assumes 19:00.

## 4. What each trigger sends

Monitoring keeps its current reference, cooldown and combining rules
(`monitoring/policy.ts`). Each trigger gates reasons as follows:

| Trigger | Reasons it gates | Notes |
| --- | --- | --- |
| `rain` | New `rain_likely`; `minimum_breach` / `minimum_recovery` for `maximumPrecipitationProbability` and `maximumPrecipitationRateMmH` | `rain_likely`: some hour from departure to finish has `precipitationProbability ≥ 0.6`, and the reference had none. It re-arms once every hour is back below 0.6. |
| `wind` | `minimum_breach` / `minimum_recovery` for `maximumGustKph` | Already computed today. |
| `cold` | New `feels_cold`; `minimum_breach` / `minimum_recovery` for `minimumTemperature` | `feels_cold`: the lowest feels like along the ride (the same series as `temperatureAlongRide`, falling back to air temperature) is below `comfortMinC`, and the reference wasn't. It re-arms when it's back at or above. |
| `betterTime` | `better_option` | Unchanged rule (≥ 5 points better, meets standards, departs later than now). |

These reasons ignore the switches:

- `evening_summary`;
- `unavailable` and `available_again`.

`rain_likely` and `feels_cold` should behave like `minimum_breach`: they bypass the
cooldown and combine with whatever else is due. When the switch for a reason is off,
the API should still update the reference, so turning the switch back on doesn't
replay old changes. (That can only happen through §6.)

Notification copy should follow `monitoring/message.ts`, naming the ride. For
example:

- "Rain is now likely on Hilly Loop (70% at 10:00)";
- "Hilly Loop will feel colder than 10° (down to 6°)".

Use the rider's units where `message.ts` already does.

## 5. Final forecast at 18:00

In `summaryAt`, change `hour: 19` to `hour: 18`. These rules stay as they are:

- **Late tracking:** a ride tracked after the summary time gets no summary
  (`createdAt <= summaryDue`).
- **Stop time:** alerts stop at departure.

If you'd rather not move it, still return `finalForecastLocalTime: "19:00"`. The
dialog follows whatever the API says.

## 6. Changing triggers (optional)

The extension doesn't need this yet. The dialog only opens from an off bell, so
choices are set when alerts turn on. If the app wants to change triggers later
without a new plan, use:

`PATCH /tracked-rides/{id}` with `{ "expectedTrackingVersion", "alerts" }`

- It bumps `trackingVersion`.
- It keeps the monitor state.

Re-posting the same `recommendationRef` with `replaceTrackedRideId` works today,
but it creates a new plan and resets monitoring.

## 7. Unchanged

- One active ride per account (`maximumActiveRides: 1`). Confirming on a second
  ride moves the alerts, as v5 does.
- Push registration, delivery transports and the notification browser view.
- `POST /recommendations` and scoring.

## 8. Tests, docs and version

- **Version:** API **0.38.0**. The algorithm stays `comfort-v0.17`.
- **Docs:** update `docs/api.md` (the tracked-ride schema and capabilities) and
  `docs/ride-monitoring.md` (reasons, gating and the 18:00 summary).
- **Tests:**
  - Validation: absent → all on; all `false` → 400; unknown keys → 400.
  - The `POST` and `GET` round trip, and old rides reading as all on.
  - Each trigger off suppresses its reasons, and only those. The summary and
    outage notices still send.
  - `rain_likely` fires at 0.6 and not at 0.59, and re-arms after dropping
    below.
  - `feels_cold` uses feels like, falls back to air temperature, and doesn't fire
    without `comfortMinC`.
  - `summaryAt` is 18:00 local, including across a clock change.
  - The capabilities include `alertTriggers` and `finalForecastLocalTime`.

## 9. Extension follow-up (done)

Done in the extension's alerts dialog PR:

- **Switches:** stored per route on the device, starting from that ride's last
  choices or all on.
- **Sending:** the choices go in `alerts.triggers` once `capabilities.alertTriggers`
  is `true`.
- **Reading back:** `ride.alerts.triggers` from `GET /tracked-rides/{id}` updates
  the stored choices.
- **Timing line:** reads `capabilities.finalForecastLocalTime`, falling back to
  19:00.

Once the API ships, the extension needs no further change.

## Decisions for Dan

1. **Score changes:** should `score_improved` and `score_worsened` (±5 points)
   still send? 29c has no switch for them.
   - Proposal: stop sending them on their own, but keep the score change in any
     notification another reason triggers.
2. **Max-temperature breach:** `maximumTemperatureC` has no switch.
   - Proposal: always send it, as today.
3. **Rain threshold:** use the design's fixed 60%, or the rider's
   `maximumPrecipitationProbability` when it's set?
   - Proposal: use 60% for `rain_likely`. Breaches of the rider's own limit
     already map to `rain` (§4).
4. **Summary time:** move it to 18:00 as the design says (§5)?

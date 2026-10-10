# Apple Weather provider

API v0.9.0 adds `apple-weather`, backed by the WeatherKit REST hourly product,
through the existing `ForecastProvider` contract. It uses the same route samples,
scoring, weather minimums and cache as Met Office. There is no Apple-specific
ranking algorithm. `comfort-v0.7` adds generic handling for full-hour averages;
existing Met Office samples and the reviewed calibration are unchanged.

From v0.10.0, [multi-day planning](planning-api.md) reuses horizon snapshots across
selected dates/windows and returns deduplicated attribution and retrieval bounds.

## Defaults and selection

New profiles, and requests without a saved profile, use strict Apple Weather with
deterministic values and retrieval-time freshness. Existing profiles keep their
persisted provider and forecast settings. No migration or named-user exception is
needed. Dan's production profile was checked before release: it explicitly selects
`met-office` with deterministic/model-run settings, which remain unchanged. The
separate reviewed v4 calibration profile selects BPF and also remains unchanged.

Authenticated clients can call `GET /weather-providers`. Each entry includes
`id`, `name`, `configured`, `recommendedSettings` and `attribution`. The top-level
`defaultPolicy` describes the new-user default, not the current user's selection.
Read the current selection from `GET /users/me`. `configured` checks local
credential configuration; it does not promise upstream availability or remaining quota.

To switch providers, use the selected entry's complete `recommendedSettings`:

```json
{
  "weather": { "mode": "strict", "providerId": "apple-weather" },
  "forecast": {
    "representation": "deterministic",
    "freshnessBasis": "retrieval-time"
  }
}
```

Send those fields on `POST /recommendations` for a temporary choice, or inside
`settings` on `PATCH /users/me` with the current `expectedVersion` to save them.
Apply both fields together: a BPF percentile configuration cannot be supplied by
Apple. Changes preserve the rider's comfort preferences. Strict mode never spends
Met Office quota on an Apple failure. Ordered fallback remains explicitly opt-in
and every listed source must support the requested statistics and freshness basis.

## Verified mapping

Apple's [hourly schema](https://developer.apple.com/documentation/weatherkitrestapi/hourweatherconditions),
[metadata](https://developer.apple.com/documentation/weatherkitrestapi/metadata)
and a live London response were checked on 10 October 2026. Metric units and data
format version 1 are validated. Unknown extra fields are tolerated.

| Apple field | Internal meaning |
| --- | --- |
| `temperature`, `temperatureApparent` | Celsius at the start of the hour |
| `windSpeed`, `windDirection` | Start-of-hour wind; km/h converted to m/s; degrees **from** true north |
| `windGust` | Maximum over the following hour, km/h converted to m/s |
| `precipitationAmount` | Liquid-equivalent accumulation over the following hour, in mm; divided by one hour for the hourly mean rate in mm/h |
| `precipitationChance` | Occurrence probability during that hour, already a 0–1 fraction; no invented numeric threshold |
| `cloudCover` | Total cloud fraction over the hour, 0–1 |
| `conditionCode`, `daylight` | Provider-neutral sky category at the hour's validity time |

`forecastStart` begins each period. Hourly means, gusts and probability events retain
their forward hour bounds. Instants retain the evaluator's existing nearest-hour
sampling rule. Apple's rate is an hourly average, unlike an instantaneous intensity;
the normalized sample records that distinction. Snowfall is not relabelled as rain.

Clear daylight maps to sunny; mostly clear/partly cloudy maps to sunny intervals.
Night equivalents remain separate. Sun showers/flurries retain their explicit
visible-sun category while precipitation affects dryness independently. Wind/heat-only
codes and unknown future symbols do not imply clear skies. Missing gusts, direction,
precipitation or required sky information remains missing and may make a departure
unassessable; zero is never invented to complete the contract.

Apple does not expose a verified model-run time. `forecastRunAt` is absent and
`unknown-model-run` remains visible, even when all requested hours are usable.
`reportedTime` becomes `issuedAt`; format version is not a forecast dataset version.
`expireTime` becomes `provenance.expiresAt`, and cache reads reject expired evidence
even within the normal 20-minute TTL. Retrieval freshness cannot establish model age.

## Access, cost and attribution

[Apple includes 500,000 calls per month](https://developer.apple.com/weatherkit/)
with an Apple Developer Program membership. This is a shared developer allowance,
not free unlimited usage or a per-user quota. A cold comparison makes one forecast
call per unique coordinate, with at most four concurrently. Compatible cached
results avoid calls; 401/403 and 429 stop queued work without automatic retries.
No paid WeatherKit subscription is enabled by this integration.

Clients displaying Apple weather must show the official Apple Weather trademark
and the legal data-source link. Use the `logo.lightUrl` / `logo.darkUrl` and `url`
provided in attribution metadata; these URLs came from Apple's
[`/attribution/en`](https://weatherkit.apple.com/attribution/en) endpoint. Preserve
the `notice` explaining that Ride On's derived assessments modify Apple data.
Forecast location provenance retains this metadata through cache reads. The API
does not proxy raw WeatherKit forecasts or disclose signing tokens to clients.

The design-3 extension renders provider selection and attribution. Its next API
integration should follow [planning and preference presets](planning-api.md).

## Server configuration

Follow Apple's [Services ID and key instructions](https://developer.apple.com/help/account/capabilities/create-a-services-identifier-and-private-key-for-weatherkit).
Any registered Services ID is eligible with a WeatherKit-enabled signing key.
The verified integration uses the existing Ride On Services ID and a separate
WeatherKit key; Sign in with Apple credentials are unchanged.

Store a JSON object containing `teamId`, `keyId`, `serviceId` and `privateKey`
(PKCS#8 PEM) as the `APPLE_WEATHER_CONFIG_JSON` Worker secret. Use a private local
file and pipe its contents to Wrangler, never put the key in command arguments:

```sh
bunx wrangler secret put APPLE_WEATHER_CONFIG_JSON < /path/to/private/weatherkit-config.json
```

For local development, set the same secret in ignored `.dev.vars`. JWTs are signed
server-side using ES256, valid for 15 minutes, and shared across the locations of
one forecast request. Tokens travel only in the Authorization header to the fixed
Apple endpoint. Redirects are rejected and upstream errors are sanitized.

Tests use synthetic WeatherKit responses and ephemeral signing keys. MSW verifies
the actual Worker's JWT signatures and covers saved-profile defaults, switching,
strict/fallback behaviour, hourly alignment, missing data, expiry and attribution.
The live credential/normalization check is separate and consumed one forecast call;
it does not establish comparative forecast accuracy or full-library performance.

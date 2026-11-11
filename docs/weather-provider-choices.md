# Weather provider choices — API 0.44.0

The public picker offers **Automatic** (`automatic`), **CWA + Apple Weather**
(`taiwan-weather`), **Apple Weather** (`apple-weather`) and **Met Office**
(`met-office`). Forecast products and statistical settings stay behind the API.
Clients that render the catalogue can expose the new choices without hardcoding them.

## UI integration

1. Fetch `GET /weather-providers`. Render `providers[].id` and `name`. This list
   contains one Met Office entry, not separate Global Spot and BPF products.
   `defaultProviderId` is `automatic`; it is not the current user's choice.
2. Read the selected value from **`GET /users/me → user.weatherProviderId`**.
   Both previously saved Met Office products report `met-office`. Do not match
   picker IDs against the technical `user.settings.weather.providerId` field.
3. Save a change with the current profile version:

```http
PATCH /users/me
Content-Type: application/json
```

```json
{
  "expectedVersion": 3,
  "settings": { "weatherProviderId": "met-office" }
}
```

Taiwan routes always use CWA + Apple Weather. For other routes, `"automatic"` selects Apple Weather and explicit choices retain their selected provider. The API selects compatible source,
representation and freshness settings together and preserves unrelated preferences.
POST `/users` accepts the same field inside `settings` for profile creation.
The user returned by create, get and patch includes `weatherProviderId` alongside
`preferenceLevels`; this is a derived display value, not a second stored preference.

For a temporary choice, send top-level `weatherProviderId` on either
`POST /recommendations` or `POST /recommendations/next-windows`. This does not save
it. Display the provider attached to the returned forecast using
`weather.selectedProvider`, for example:

```json
{ "id": "met-office", "name": "Met Office" }
```

`weather.requestedProviderId` describes the requested choice, including `automatic`; `selectedProvider` describes the resolved product.
Continue displaying **the response's `weather.attribution`**, including any logos
or notices. `weather.selectedSource` and location provenance retain the exact
technical product/adapter identifiers for diagnostics; do not use those as picker
labels. When no forecast is attempted, `selectedProvider` is null. It may name a
failed source when an attempt was made; availability still comes from the normal
forecast/coverage fields, not the presence of this label.

## Selection policy and compatibility

- Taiwan routes always select CWA + Apple Weather, overriding saved and temporary
  provider choices and advanced policies. The geographic check is per route,
  so UK routes in the same shortlist cannot suppress CWA. Non-Taiwan routes use
  the saved/requested policy; Automatic resolves to Apple Weather.
- CWA + Apple Weather uses CWA township temperatures, sustained wind and native
  three-hour precipitation probabilities, with Apple hourly gusts, rainfall and
  missing fields/periods. It has its own cache/source identity. Field evidence
  records the actual provider, representative point, timestamps, native event and
  interpolation. Its advertised horizon is up to 240 hours through Apple, with
  CWA's usual three-day contribution. See [Taiwan weather](cwa-weather.md).
- Choosing Met Office selects the existing UK blended hourly product, with
  ensemble-summary values and retrieval-time freshness. Its advertised hourly
  horizon is 120 hours. Actual data coverage remains evidence-based; do not
  present this number as a guarantee for every date/location/parameter.
- Choosing Apple selects its deterministic hourly product and retrieval-time
  freshness.
- Existing stored policies are **not migrated or rewritten**. They continue to
  govern non-Taiwan routes. The Taiwan override is applied at evaluation time,
  with the deterministic/retrieval-time preset required by the composite.
- For that reason, an older Global Spot profile may have a shorter actual horizon
  than the catalogue's current Met Office choice. Always use recommendation
  availability metadata for the dates a user can assess.
- A failed or unconfigured Met Office selection is reported as unavailable. It
  does not fall back to Global Spot, nor combine statistics across products. The
  BPF configuration determines the new Met Office choice's `configured` flag; it
  is not a health or quota check.
- **Quota exhaustion is the one exception (v0.42.0).** When a Met Office location comes
  back `rate-limited`, the provider can't finish the comparison, so the non-Taiwan
  group moves to Apple Weather's deterministic preset. Taiwan keeps its CWA-first
  product. The response says so:
  - `weather.requestedProviderId` stays `met-office`.
  - `weather.selectedProvider` / `selectedSource` name Apple Weather.
  - `weather.attempts` lists the Met Office attempt, then Apple's.
  - `weather.fallback` is `{ "reason": "rate-limited", "retryAt": "<ISO>" | null }`
    (`retryAt` from the upstream `Retry-After`); it is `null` otherwise.
  - The response's `forecast` is Apple's (`deterministic`, `retrieval-time`).

  If Apple Weather is unavailable too, the original Met Office result is kept and
  `fallback` stays `null`. Saved settings never change. Advanced ordered-fallback
  policies (`weatherProviderId: null`) keep their own list and get no quota
  fallback. The Taiwan composite already uses Apple supplements and never retries an Apple quota failure as another Apple policy. A tracked ride compared with Apple during the outage sees a context
  change when Met Office returns.
- Existing advanced `weather` / `forecast` fields and catalogue
  `recommendedSettings` pairs remain supported. An old `weather.providerId:
  "met-office"` still means Global Spot; the new **`weatherProviderId`** field is
  the public provider choice. Clients applying the catalogue's full
  `recommendedSettings` continue to receive a compatible Met Office preset.
- Reject `weatherProviderId` combined with `weather` or `forecast` in the same
  settings patch/request: there is no implicit precedence. Unknown public choice
  IDs, including `met-office-bpf`, return 400. Advanced product IDs are unchanged.
- Advanced ordered-fallback/custom policies return `user.weatherProviderId: null`.
  Preserve them or display a custom state; do not silently save the default while
  rendering the picker. Their selected forecast still has a provider label when
  its source belongs to a known provider.

## Mixed-region responses

`weather.routeSources[]` identifies each route's selected source/provider,
forecast representation, freshness/quality requirements and quota fallback.
For a single policy group the existing top-level source, quality and fallback
fields retain their meaning. With multiple groups those fields are `null`;
`weather.attempts`, attribution and location evidence include both groups.
Top-level `forecast.representation` or `freshnessBasis` is `mixed` only when the
groups use different values. The exact values always remain in `routeSources`.
CWA's native probability event is never evaluated as Apple's hourly event or
Met Office's ensemble statistic. Previous-score and tracking context identities
retain the regional source choices; a provider change cannot appear to be a
weather-driven score change.

## Backend structure and verification

`weather/choices.ts` maps public provider choices to compatible internal presets;
`weather/providers.ts` registers the underlying adapters. Existing comfort weights and single-provider cache identities are unchanged; the Taiwan composite explicitly adds field provenance and a distinct probability descriptor. Adding a provider
means registering its adapter and adding a public choice; clients need no knowledge
of product IDs or percentile/freshness requirements.

No database migration is required. MSW integration tests cover both Met Office
products, profile persistence, switching, temporary overrides, both recommendation
endpoints, incompatible input rejection, failures, cache reuse and source honesty.
No live forecast calls are needed for these checks.

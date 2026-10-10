# Extension brief v2: design changes

The agreed API work is implemented in v0.10.0. Use the
[implemented contract](planning-api.md) for multi-day searches, saved planning,
preference presets, units, verdicts, breach timestamps and weather summaries.
These proposals from the brief should change:

- **Always compute seven days:** request `previewDays: 7` explicitly. A single-day
  caller should not pay for seven evaluations. Replace the extension's daily
  fan-out with one `days` request; let the API own ordering.
- **Infer availability from provider hours or 05:00/21:00:** advertised horizons
  are capabilities. Use actual `days[].availability` and `availabilityReason`.
  Provider errors are not “Not yet”; unknown providers do not imply 48 hours.
- **Introduce `time.mode`:** reuse `planning.window: "daylight" | {start,end}`.
  Keep “Next few days” capped at five. Expired ranges stay expired.
- **Score missing climbing as though it did not matter:** that rewards missing
  data and makes scores incomparable. Keep the route unranked; show its optional
  `partialAssessment.weatherScore` as weather-only, with “Climbing could not be
  assessed”. Its combined score is null. Do not call this a forecast failure.
- **Keep controls that do nothing:** connect sunshine/rain to `preferenceLevels`.
  Preserve `custom`. “Don't mind” now has zero scoring influence; explicit minimum
  standards still apply. Remove the tailwind toggle: directional wind assessment
  is always active, with no separate bonus for stronger tailwinds.
- **Say “tailwind home” from route averages:** arbitrary GPX files do not identify
  home or an outbound/return split. Use route or hourly wind summaries instead.
- **Give partially covered rides ordinary scores:** ranked rides have complete
  weather evidence. Route `coverage` describes assessed departure slots, not a
  percentage of the ride scored. Use intervals for gaps; `until` is supplied only
  for a continuous coverage prefix.
- **Call lead time “confidence”:** do not show the proposed 1–3 confidence rating.
  Forecast lead time alone does not measure uncertainty.
- **Use the first failure's time or the hottest unrelated route:** use each
  failure's `at`/`positionKm`, and the day temperature tied to its recommended ride.
- **Show the newest retrieval as freshness for everything:** use
  `weather.retrieval.oldestAt/latestAt`; neither means “model updated”. Display
  `weather.selectedSource` and supplied attribution, including Apple branding.

No default minimum standards are introduced. Do not interpret “no minimums
configured” as “minimums met”. A result with no assessable recommendation gets no
Best pick/Best available flag. Temporary choices must not be silently saved.

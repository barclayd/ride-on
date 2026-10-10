# Ride On: Chrome extension design handoff

## Purpose and scope

Please adapt the existing Cycle.travel extension design to the behaviours below. Preserve the overall layout and visual direction; the changes concern control meanings, saved preferences and result states.

This handoff follows a review of the [extension API brief in PR #86](https://github.com/barclayd/ride-on/pull/86). The review was based on that brief, not the actual design screens. These are proposed design requirements for the next iteration, not a claim that every supporting API feature already exists. Where they differ from the original brief, flag the difference when updating it.

The API should own scoring, preference interpretation, feasibility and result ordering. The extension should own presentation and interaction. Multi-day recommendations, saved planning defaults and guided preference mappings require API work alongside the design.

## Changes to controls

| Area | Requested design behaviour |
| --- | --- |
| Minimum conditions | Keep the steppers, but support **No limit** for each condition. Enabling a limit reveals its value. Do not assign restrictions to existing users who have not configured them. |
| Seasonal temperature limits | Support **Fixed** and **Varies by month**. A compact seasonal summary can open a monthly editor. Editing one month must preserve the other months; do not silently convert a seasonal profile into a fixed limit. |
| Forecast confidence | Omit the proposed three-level confidence indicator for this release. Show the weather provider and an accurately labelled retrieval time, plus incomplete-coverage warnings when needed. Forecast lead time alone is not a confidence assessment. |
| Rain preference | For a control that changes importance, use **Don't mind**, **Prefer dry** and **Strongly prefer dry**. **Light rain is okay** describes an intensity tolerance and would need a separately defined API behaviour. |
| Wind preference | Allow headwind and crosswind comfort to differ. These controls can live inside an expandable **Wind preferences** area. Do not display one value while silently overwriting two different saved settings. |
| Date selection | Display the actual dates available for planning. Prefer **Next few days** to a permanently fixed **Next 5 days** label. Explain partial coverage, for example: **Saturday available; Sunday's forecast isn't available yet.** Availability must come from the API. |
| Time window | Offer **Daylight hours** and **Choose times**. Label custom fields **Earliest start** and **Latest finish**. Add: **Your whole ride must fit inside this window.** Custom windows remain subject to daylight constraints for this release. |
| Expired selections | Show **These dates have passed**, with an action to choose available dates. Do not silently replace an expired search with a different date range. |
| Climbing preference | Use **Flatter**, **No preference** and **Hillier**. Dan has chosen climbing per kilometre, with a modest influence: 90% weather comfort and 10% terrain preference. No preference preserves weather-only scoring. This is the API v0.7.0 contract; no maximum-ascent control is included yet. |

Simple controls must also handle an existing **Custom** preference. Display that state clearly and preserve its saved values until the rider deliberately chooses a replacement. Opening or saving an unrelated setting must not reset custom preferences.

## Result states

Use the existing ride cards, with distinct labels and explanations for these outcomes:

| Outcome | What the rider should see |
| --- | --- |
| Meets your preferences | A comfort score, recommended departure and estimated finish. |
| Below your minimum conditions | The available score and specific drawbacks. The best available option can still be highlighted, with the shortfall clearly visible. |
| Doesn't fit your window | The estimated ride duration and an explanation of why it cannot fit. Do not present this as poor weather. |
| Forecast incomplete | Explain that the route cannot be fully assessed. An unassessable route has no score, rather than a zero score. If the API can return a partial assessment, retain its coverage warning. |

When an active climbing preference cannot be assessed because elevation is missing,
show **Elevation unavailable** with **We need elevation data to assess your climbing
preference.** Keep the route visible without a score. It can still be assessed on
weather when the rider chooses **No preference** for climbing. Available ascent is
an estimate; preserve the API's elevation warnings.

When no evaluated option meets the rider's configured minimums, show a prominent message above the results:

> None of these rides meets all your minimum conditions. Here are the best available options.

Use that message only when the API confirms this outcome. Missing forecasts require different wording, such as:

> We couldn't confirm a ride that meets your minimum conditions because some forecasts are unavailable.

The API supplies the final ordering and assessment. The extension must not recreate the scoring rules or re-sort recommendations using its own interpretation of these states.

## Scores and weather summaries

- Label the number **Comfort score**, for example **78/100**. It represents suitability for the rider's preferences, not forecast confidence or a probability.
- For multi-day results, always show the recommended **date as well as departure time**, together with the estimated finish.
- Tie weather summaries to the recommended ride and its timing. Do not present the warmest temperature anywhere across all saved routes as the expected temperature for the recommendation.
- Label retrieval time as **Forecast retrieved**, not **Forecast updated**, unless the API actually provides the upstream publication time.

## What can stay

Preserve the overall layout, saved-route selection, preferences tab, sunshine controls, ideal temperature range and ranked ride cards. A full visual redesign is unnecessary.

Shared preferences and useful planning defaults belong on the API profile. Temporary selections, unsaved edits and loading state can remain local to the extension.

Forecast caching, quota handling, performance and provider substitution are API implementation responsibilities. The interface needs clear loading and unavailable states, but should not expose those implementation details to the rider.

## Requested design deliverable

Update the affected controls and supply examples of the four result states, the no-matching-rides message, incomplete forecast coverage and an expired date selection. Identify any remaining product decisions explicitly so the API and extension can agree on their meaning before implementation.

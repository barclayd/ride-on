# Ride On Web: design system (seed)

This is the **seed**, not the system. Claude Design builds the "Ride On Web" design system
from it (design-first, [`../SPEC.md`](../SPEC.md) §13). Once the look settles, the export
replaces this folder, and from then on this folder is the source of truth.

Inputs to upload to the Claude Design project:

- this README and [`tokens.css`](tokens.css)
- [`../SPEC.md`](../SPEC.md)
- [`../../DESIGN-SYSTEM.md`](../../DESIGN-SYSTEM.md): the iOS system the web takes after
- [`../../docs/maps/cycle-travel-style.md`](../../docs/maps/cycle-travel-style.md): the map
  palette, for the dark map exploration

Never the AnyVan design system.

## Rules carried over from iOS

- **Glass is the functional layer:**
  - These are glass: the panel, the day strip, the map controls, popovers and the glance card.
  - These are solid: rows, cards and chips inside the panel.
  - Glass never sits on glass.
- **Regular glass only.** The cycle map is light, so there's no clear glass.
- **One tinted action per screen** at most.
- **Triple encoding:** colour + number or symbol + words.
- **Semantic colours** for the UI. The one custom palette is the score bands plus iOS's
  status colours.
- **Title Case** for section headers. Everything else is sentence case, with en-GB dates.

## Tokens

The values live in `tokens.css`, which covers:

- **Type:** the system stack, with sizes in `rem`.
- **Colour:** light and dark, including the status colours.
- **Score bands:** Great ≥ 75, Good 60–74, Fair 50–59, Not recommended < 50.
- **Glass recipe**, with its fallbacks for Reduce Transparency, Increase Contrast and Forced
  Colors.
- **Shape:** panel 34, card 26, selected row 22, thumbnail 11.
- **Layout:** panel 380 wide, 12 inset, medium detent 56%.
- **Motion:** stand-ins for `Motion.swift`.

## Component inventory (seed)

This mirrors DESIGN-SYSTEM.md §6. Claude Design may merge or rename components. Once exported,
the list is closed, as on iOS.

| Component | iOS counterpart | Notes |
|---|---|---|
| `MapShell` | — | One MapLibre map and four slots (panel, day strip, controls, overlay). Sets the map padding from the slot sizes. |
| `Panel` | `FloatingPanel` | A 380px left column on desktop; a bottom sheet with medium and large detents on mobile |
| `DayStrip` | `DayStrip` | 7 bars in band colours, the best day pre-selected, floating glass |
| `BestPickCard` | `RideHero` + conditions card | Solid, at the top of the panel's home |
| `RouteRow` | `LibraryRow` / Rides rows | Scored rows (band, score, times, conditions) and library rows (facts, Add to shortlist) |
| `GlanceCard` | `RoutesMap` callout | Desktop hover over a line; click selects |
| `MapKey` | — | A band chip that opens a popover: bands, the "Full cycle map" switch, network legend |
| `SwapPopover` | — | For the 13th shortlist add; the lowest-scoring route pre-selected |
| `ConditionChip` | `ConditionChip` | At most 4 per row |
| `ScoreRing` | `ScoreGauge` | Detail verdict card |
| `DeparturePicker` | `DeparturePicker` | Best + 3 alternatives |
| `FactorRow` | `FactorRow` | "Why it scored N" |
| `RouteProfile` | `RouteProfile` | Elevation, wind strip and temperature on a km axis, scrub synced with the map |
| `ShareBar` | `ShareBar` | Sky and wind shares |
| `WindCompass` | `WindCompass` | |
| `TemperatureRange` | `TemperatureRange` | Preferences |
| `WindEnvelope` | `WindEnvelope` | Preferences |
| `Toast` | — | Undo after removing a route, "Couldn't refresh" |

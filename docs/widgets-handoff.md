# Ride On: widgets handoff

Where the widget redesign stands on 27 October 2026, for whoever picks it up next. The spec is
[§8 of the redesign README](redesign/README.md#8-widgets-and-lock-screen) and its Build checklist;
this covers the state, the code, how to test it and what's left.

## State

- [#292](https://github.com/barclayd/ride-on/pull/292) built the widgets:
  - A, the departure board, and D, the tracked ride, in every family.
  - The Live Activity, the Dynamic Island and the Control Centre control.
- [#295](https://github.com/barclayd/ride-on/pull/295) fixed what the simulator pass found. Both
  PRs are merged.
- Design canvas: [Ride On widgets, v45](https://claude.ai/artifact/9rYWTxdZVkx21dpJRrue7T).
- Every surface after the fixes: [Ride On widget shots](https://claude.ai/artifact/JzSpuGyEJpk1i9ippeEQVS).
- Both artifacts are private to Dan's account. An agent in that account can open them with the
  Artifact tool's `read` action.

Dan's decisions, so they aren't reopened:

- **One adaptive widget, no configuration.**
  - A shows when nothing's tracked.
  - D shows from the moment a ride is tracked until two hours after it ends.
- **D:** the score and conditions lead. A ride-time estimate ("~3h ride", "1h 30m to go")
  replaced "leave in". The map shows in every size.
- **A:** the map shows in small, medium and large. It has Track and day paging.
- **Live Activity:** runs from three hours before the start (scheduled, with an alert) to the
  finish.
- **Surfaces wanted beyond the Home Screen:** StandBy, iPad extra large, the Mac desktop and a
  Control Centre control.
- **No Directions anywhere** (DESIGN-SYSTEM.md §1).

## Code

| Path | What it does |
|---|---|
| `app/Packages/Models/Sources/Models/RideWidgetSnapshot.swift` | The Codable data the widgets read: the board's days, the tracked ride and the units. Also the text helpers `rideTime(at:short:)` and `duration`. Tested in `ModelsTests/RideWidgetSnapshotTests.swift` |
| `app/App/WidgetSync.swift` | The app side, which:<br>• builds the snapshot from `RideBoard` and `TrackedRide`, and saves it to the App Group only when it changed;<br>• renders map stills while the app is in front (`CycleMapStill` on iOS, `MKMapSnapshotter` on the Mac);<br>• reloads timelines and controls;<br>• starts, updates and ends the Live Activity.<br>In the fixture world it moves the snapshot to `--fixture-now` with `snapshot.current()` |
| `app/Shared/WidgetShared.swift` | Compiled into the app and the extension: `WidgetStore` (App Group defaults and container), `RideLink` deep links, `OpenRideIntent`, `RideActivityAttributes` |
| `app/Shared/WidgetMap.swift` | The still shapes (band, tall, square), their framing and file URLs, and projecting the loop onto them |
| `app/Widgets/RideWidget.swift` | The widget, its timeline and the `PageDay` intent. The timeline has entries every five minutes through the ride, at the finish, two hours on and at midnight |
| `app/Widgets/BoardViews.swift` | A, in every family including the Lock Screen accessories |
| `app/Widgets/TrackedViews.swift` | D, in every family including the Lock Screen accessories |
| `app/Widgets/WidgetParts.swift` | Shared parts: `MapPanel`, `ScorePill`, `ScoreArc`, `Conds`, `HourCells`, `Color.rideAccent` |
| `app/Widgets/RideLiveActivity.swift` | The Live Activity's Lock Screen view and the Dynamic Island |
| `app/Widgets/RideControl.swift` | The Control Centre control: the tracked ride's name, otherwise "Track Best" |

The extension links only Models and DesignSystem, never SharedUI or MapLibre. Maps reach it as
JPEG stills the app writes into the App Group.

## What's left

1. **Done: the Live Activity's mid-ride text.** It used to say the planned "~3h ride" mid-ride
   while the widgets said "1h 30m to go". Now `ActivityRideTime` in `RideLiveActivity.swift` picks
   the text from the time it's drawn:
   - before the start, the plan: "~3h ride · 09:00 → ~12:00";
   - from the start, `Text(timerInterval: start...finish, countsDown: true)`, which ticks without
     updates: "1:29:59 to go · back ~12:00";
   - from the finish, "Ride over".

   An activity only redraws when the app updates it or its stale date passes, so `WidgetSync`
   sets the stale date to the start until the ride starts, then to the finish. The switch at the
   start needs no app. The one at the finish needs the app to have synced mid-ride (opened, or a
   background refresh). If it hasn't, the countdown stops at "0:00 to go" until the next sync
   ends the activity.
2. **Dan's on-device check:**
   - StandBy;
   - iPad extra large (`systemExtraLarge`);
   - the Mac desktop widget;
   - the Live Activity's scheduled start and alert.

   The simulator pass didn't cover these. A later one saw the scheduled start come up on time
   on a light platter under white text, so the Lock Screen view now draws its own background as
   well as the tint. The alert's sound and banner still need a device.

## Testing on the simulator

Launch with:

```
--fixture-world -CycleMapTiles https://maps.ride-on.cc --fixture-now 2026-10-14T07:30:00+01:00
```

- `--fixture-now` moves the sample so that instant is now:
  - 07:30 is the morning of Wednesday's Hilly Loop.
  - 10:30 is mid-ride.
- The fixture world drops tiles unless `-CycleMapTiles` is passed.
- The pass used an iPhone 17 on iOS 27.

Things that catch you out:

- **The tracked ride doesn't survive a relaunch.** `RideTracker` keeps it in memory, so track
  again after every launch.
- **`--fixture-now` moves the sample on every sync,** not just at launch, so the anchor is always
  now. A ride two minutes off stays two minutes off while the app is in front. Count from the
  app's last sync, which is usually when it leaves the screen.
- **Widgets can show stale data.** The App Group snapshot outlives the app, and the widgets show
  whatever was saved last. If the app launches behind an open Lock Screen editor, it never
  becomes active, so the widgets keep the previous run's data. Close the editor first.
- **Maps need time.** Map stills render only while the app is in front. Give it 15–30 seconds
  after launch before taking shots.
- **First run asks permission.** iOS asks "Allow Live Activities from RideOn?" the first time.

### Driving SpringBoard from an XCUITest

The scratch test that took the shots was never committed. It drives SpringBoard, is slow, and
breaks whenever SpringBoard changes, so keep any new one out of the test plan.

Setup:

- Drive SpringBoard with `XCUIApplication(bundleIdentifier: "com.apple.springboard")`.
- Take shots with `XCUIScreen.main.screenshot().pngRepresentation`, written to a file.

**Home Screen widgets:**

1. Press Home.
2. Long-press an empty spot at normalised offset (0.5, 0.75) for 1.5 s.
3. Tap `Edit`, then `Add Widget`.
4. In the "Search Widgets" field, type "Ride", then tap the cell whose label begins with "Ride".
5. For medium and large, swipe the preview left.
6. Tap the button whose label contains "Add Widget", then tap `Done`.

**Track from the widget:**

1. Tap the large widget's `Track` button. The app opens the "Track This Ride" sheet.
2. Tap `Start Tracking`.

**Dynamic Island, expanded:** long-press at (0.5, 0.03).

**Lock and wake:** call `XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))`,
then press Home.

**Lock Screen accessories:**

1. On the Lock Screen, long-press at (0.5, 0.5).
2. Tap `posterboard-customize-button`, then the "Lock Screen" button.
3. Open a widget area: `grouped-widgets-reticle-view` (rectangular and circular) or
   `inline-widget-reticle-view` (use `.firstMatch`).
4. In the gallery that opens, the inline option is the cell "RideOn, Ride On, Top Widget".

Watch out for:

- The gallery sheet hides the reticles. Dismiss it before tapping the other area.
- `editing-done` didn't save the inline widget in the simulator, so take the shot inside the
  editor.
- Always leave with `editing-done` or `editing-cancel`.

**Control Centre:**

1. Drag from (0.9, 0.005) to (0.9, 0.7).
2. Edit it, then search the controls gallery for "Ride On".

## Gotchas

- **The accent colour:** `Color.accentColor` is system blue inside a widget. Use
  `Color.rideAccent`, which is the asset catalog's AccentColor.
- **Lock Screen accessories:**
  - They render in a single tint. Mark the parts that should take the accent with
    `.widgetAccentable()`.
  - Width is tight. Use `ViewThatFits` so the least important part drops before anything
    truncates (A's rectangular drops "back ~…" before the name).
- **ActivityKit's 4 KB limit:** `WidgetSync` strips the loop and the hours from the activity's
  state and puts a loop of about 30 points in the attributes.
- **New files:** after adding or removing files, run `cd app && xcodegen generate`.

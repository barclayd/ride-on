// Pure view-model helpers shared by the popup, the Journeys page and the background.
// Type-only imports keep this loadable by `bun test` without wxt/browser.
import type {
  Checkin,
  Days,
  LocalPrefs,
  Pause,
  Pick,
  Planning,
  Search,
  Shown,
  State,
} from '../lib/state';
import type {
  Conditions,
  DaySummary,
  Departure,
  Failure,
  Levels,
  NextWindow,
  Outline,
  Preferences,
  PreferencesPatch,
  RecentRides,
  Recommendations,
  Ride,
  RidePlan,
  RideSummary,
  RouteResult,
  RouteSummary,
  SkyShares,
  Standard,
  StandardsStatus,
  TrackedDeparture,
  Window,
} from '../lib/types';

type Unit = State['unit'];

const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const utcFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });
const weekdayFormat = utcFormat({ weekday: 'short' });
const longWeekdayFormat = utcFormat({ weekday: 'long' });
const monthFormat = utcFormat({ month: 'short' });
const longMonthFormat = utcFormat({ month: 'long' });

export const weekday = (date: string) => weekdayFormat.format(noon(date));
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
// en-GB says "Sept"; the design says "Sep".
const month = (date: string) => monthFormat.format(noon(date)).slice(0, 3);
export const longWeekday = (date: string) =>
  longWeekdayFormat.format(noon(date));
export const shortDate = (date: string) =>
  `${weekday(date)} ${dayOfMonth(date)} ${month(date)}`;
export const addDays = (date: string, days: number) =>
  new Date(noon(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const localDate = (at: Date | string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
export const clock = (at: Date | string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
export const hours = (at: string, timeZone: string) => {
  const [h, m] = clock(at, timeZone).split(':').map(Number);
  return h + m / 60;
};
export const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
// "Tuesday to Friday" for a run of days, else "Tuesday, Wednesday and Friday".
const join = (dates: string[]) => {
  const names = dates.map(longWeekday);
  const last = names.pop() ?? '';
  const run =
    dates.length > 2 &&
    dates.every((date, i) => i === 0 || addDays(dates[i - 1], 1) === date);
  return run
    ? `${names[0]} to ${last}`
    : names.length
      ? `${names.join(', ')} and ${last}`
      : last;
};

export const qualityColour = (score: number) =>
  score >= 75 ? '#8bc61f' : score >= 60 ? '#c9b458' : '#d98b4a';

// A local date and time as a UTC instant.
// ponytail: can be an hour out within an hour of a DST change; fine for "has the window ended".
export const instant = (date: string, time: string, timeZone: string) => {
  const guess = new Date(`${date}T${time}:00Z`);
  const local = Date.parse(
    `${localDate(guess, timeZone)}T${clock(guess, timeZone)}:00Z`,
  );
  return new Date(2 * guess.getTime() - local).toISOString();
};

// The days from start to end, inclusive.
export const span = (start: string, end: string) => {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
};

// The planned dates as the API resolves them (worker/src/recommendations/planning.ts); null once passed.
// Next 5 days starts tomorrow: the API's next-five-days, not its next, which starts today.
export const planningDates = (
  planned: Days,
  today: string,
): string[] | null => {
  if (planned.kind !== 'preset') {
    const dates = (
      planned.kind === 'dates'
        ? planned.dates
        : span(planned.start, planned.end)
    ).filter((date) => date >= today);
    return dates.length ? dates : null;
  }
  if (planned.preset === 'today') return [today];
  if (planned.preset === 'tomorrow') return [addDays(today, 1)];
  if (planned.preset === 'next')
    return span(addDays(today, 1), addDays(today, 5));
  const day = noon(today).getUTCDay(); // 0 is Sunday
  if (day === 0) return [today];
  const saturday = addDays(today, 6 - day);
  return [saturday, addDays(saturday, 1)];
};

// Tap a day to add or remove it; gaps stay gaps. Null: the only day stays on.
export const toggleDay = (
  selected: string[] | null,
  date: string,
): Days | null => {
  const dates = selected?.includes(date)
    ? selected.filter((d) => d !== date)
    : [...(selected ?? []), date].sort();
  return dates.length ? { kind: 'dates', dates } : null;
};

// Runs of days read as spans and the month shows where it changes: "Tue 13 – Thu 15 & Sat 17 Oct".
export const datesLabel = (dates: string[]) => {
  const runs: [string, string][] = [];
  for (const date of dates) {
    const run = runs.at(-1);
    if (run && addDays(run[1], 1) === date) run[1] = date;
    else runs.push([date, date]);
  }
  const day = (date: string, next?: string) =>
    next && month(next) === month(date)
      ? `${weekday(date)} ${dayOfMonth(date)}`
      : shortDate(date);
  const parts = runs.map(([start, end], i) => {
    const next = runs[i + 1]?.[0];
    return start === end
      ? day(start, next)
      : `${day(start, end)} – ${day(end, next)}`;
  });
  const last = parts.pop() ?? '';
  return parts.length ? `${parts.join(', ')} & ${last}` : last;
};

export const timeText = (
  planning: Planning,
  daylight: Window | null,
  timeZone: string,
) =>
  planning.time.mode === 'custom'
    ? `${planning.time.start}–${planning.time.end}`
    : daylight
      ? `${clock(daylight.start, timeZone)}–${clock(daylight.end, timeZone)}`
      : 'Daylight hours';

const unavailable = (dates: string[]) =>
  `${join(dates)}${dates.length > 1 ? "'s forecasts aren't" : "'s forecast isn't"} available yet`;
const notYet = (selected: DaySummary[]) =>
  selected
    .filter((d) => d.availabilityReason === 'outside_forecast_horizon')
    .map((d) => d.date);

export const coverageText = (selected: DaySummary[], timeZone: string) => {
  const full = selected.filter((d) => d.availability === 'full');
  const partial = selected.find((d) => d.availability === 'partial');
  const none = notYet(selected);
  if (!partial && !none.length) return null;
  const parts = [];
  if (full.length) parts.push(`${join(full.map((d) => d.date))} available`);
  if (partial) {
    const until = partial.until && clock(partial.until, timeZone);
    parts.push(
      until
        ? `${longWeekday(partial.date)}'s forecast only covers ${until <= '12:00' ? 'the morning' : `up to ${until}`}`
        : `${longWeekday(partial.date)}'s forecast is missing some weather details or hours along your routes`,
    );
  }
  if (none.length) parts.push(unavailable(none));
  const text = `${parts.join('; ')}.`;
  return text[0].toUpperCase() + text.slice(1);
};

const NONE: Record<string, [string, string]> = {
  outside_forecast_horizon: ['Not yet', 'Forecast not available yet'],
  no_feasible_departure: ['No fit', 'No ride fits your window'],
  no_remaining_window: ['Passed', 'Your window has passed'],
  provider_unavailable: ['No data', 'Your forecast provider returned no data'],
};
// Display units; the API and stored preferences stay in °C and km/h.
export type Units = { temperature: '°C' | '°F'; wind: 'km/h' | 'mph' };
export const METRIC: Units = { temperature: '°C', wind: 'km/h' };
// ponytail: the US reads °F and mph, the UK °C and mph, everywhere else metric. Add regions as riders ask.
export const regionUnits = (locale: string): Units => {
  const region = new Intl.Locale(locale).maximize().region;
  return {
    temperature: region === 'US' ? '°F' : '°C',
    wind: region === 'US' || region === 'GB' ? 'mph' : 'km/h',
  };
};
// From the whole °C, so °F always matches what °C would show (10–11°C reads 50–52°F).
export const degrees = (c: number, u: Units) =>
  Math.round(u.temperature === '°F' ? Math.round(c) * 1.8 + 32 : c);
const speedValue = (kph: number, u: Units) =>
  Math.round(u.wind === 'mph' ? kph * 0.621371 : kph);
export const speed = (kph: number, u: Units) =>
  `${speedValue(kph, u)} ${u.wind}`;

// A day strip tile from the API's summary of that day; '–' until it arrives.
export const tile = (
  d: DaySummary | undefined,
  timeZone: string,
  u: Units = METRIC,
) => {
  const blank = { kind: 'full', label: '–', title: undefined, quality: null };
  if (!d) return blank;
  if (d.availability === 'none') {
    const [label, title] = NONE[d.availabilityReason] ?? [
      'No data',
      'Forecast unavailable',
    ];
    return { kind: 'none', label, title, quality: null };
  }
  const until = d.until && clock(d.until, timeZone);
  return d.availability === 'partial'
    ? {
        kind: 'partial',
        label: until ? `To ${until}` : 'Partial',
        title: until
          ? `Forecast up to ${until}`
          : 'Some weather details or hours are missing along your routes',
        quality: d.quality,
      }
    : {
        ...blank,
        label:
          d.temperatureMaxC === null
            ? '–'
            : `${degrees(d.temperatureMaxC, u)}°`,
        quality: d.quality,
      };
};

export const conditionsText = (c: Conditions, u: Units = METRIC) => {
  const low = degrees(c.temperatureC.minimum, u);
  const high = degrees(c.temperatureC.maximum, u);
  const winds: [string, number][] = [
    ['tailwind', c.averageTailwindKph],
    ['headwind', c.averageHeadwindKph],
    ['crosswind', c.averageCrosswindKph],
  ];
  const [kind, kph] = winds.reduce((a, b) => (b[1] > a[1] ? b : a));
  const wind =
    c.averageWindSpeedKph < 5 ? 'light wind' : `${kind} ${speed(kph, u)}`;
  return `${low === high ? high : `${low}–${high}`}° · ${wind} · ${rainText(c)}`;
};
export const tempText = (c: Conditions, u: Units = METRIC) =>
  `${degrees(c.temperatureC.maximum, u)}°`;
// ponytail: under 10% reads as dry; the card is a summary, the API keeps the detail.
export const rainText = (c: Conditions) => {
  const rain = Math.round(c.maximumPrecipitationProbability * 100);
  return rain < 10 ? 'dry' : `${rain}% rain`;
};

// Journeys tile chips, always temperature · wind · rain; amber where that condition lowers the score.
export const NAMED_WIND_KPH = 10; // below this, the wind's direction isn't worth naming, whatever the unit
const WET: Record<string, string> = {
  drizzle: 'Drizzle',
  light_showers: 'Light showers',
  showers: 'Showers',
  heavy_showers: 'Heavy showers',
  light_rain: 'Light rain',
  rain: 'Rain',
  heavy_rain: 'Heavy rain',
  sleet: 'Sleet',
  hail: 'Hail',
  snow: 'Snow',
  thunder: 'Thunderstorms',
};
export type Chip = {
  icon:
    | 'temperature'
    | 'wind'
    | 'dry'
    | 'wet'
    | 'sun'
    | 'sunCloud'
    | 'cloud'
    | 'fog';
  text: string;
  label: string;
  warn: boolean; // amber: against what the rider asked for
};
// The API's defaults, for users that predate them (planning-api.md).
export const DEFAULT_LEVELS: Levels = { sunshine: 'nice', rain: 'light-ok' };
export const conditionChips = (
  c: Conditions,
  u: Units = METRIC,
  prefs: Partial<Preferences> = {},
  levels: Levels = DEFAULT_LEVELS,
): Chip[] => {
  const { temperature: comfort, wind: windComfort } = prefs;
  const low = Math.round(c.temperatureC.minimum);
  const high = Math.round(c.temperatureC.maximum);
  const [from, to] = [degrees(low, u), degrees(high, u)];
  const temp = `${from === to ? to : `${from}–${to}`}${u.temperature}`;
  const shown = speed(c.averageWindSpeedKph, u);
  const f = c.windDistanceFractions;
  // Named only when one direction covers most of the route.
  const kind =
    f && c.averageWindSpeedKph >= NAMED_WIND_KPH
      ? (['tailwind', 'crosswind', 'headwind'] as const).find((k) => f[k] > 0.5)
      : undefined;
  const pct = Math.round(c.maximumPrecipitationProbability * 100);
  const chance = `${pct}% chance of rain`;
  const summary = c.precipitationSummary ?? (pct < 10 ? 'dry' : 'possible');
  const rain =
    summary === 'dry'
      ? null
      : summary === 'possible'
        ? chance
        : (WET[summary] ?? 'Rain');
  return [
    {
      icon: 'temperature',
      text: temp,
      label: `Temperature ${temp}`,
      warn:
        !!comfort && (low < comfort.comfortMinC || high > comfort.comfortMaxC),
    },
    // The wind pill opens "Wind along the ride", where the gusts are; the pill never shows them.
    {
      icon: 'wind',
      text: kind ? `${shown} ${kind}` : shown,
      label: kind
        ? `${kind[0].toUpperCase()}${kind.slice(1)} ${shown}`
        : `Wind ${shown}`,
      // The speed shown against the comfort for its direction; a mix includes some headwind.
      // A rider who prefers calm loses points to any named wind, a tailwind too.
      warn:
        (!!windComfort &&
          !windComfort.preferTailwind &&
          c.averageWindSpeedKph >= NAMED_WIND_KPH) ||
        (kind !== 'tailwind' &&
          c.averageWindSpeedKph >
            (kind === 'crosswind'
              ? (windComfort?.comfortableCrosswindKph ?? 20)
              : (windComfort?.comfortableHeadwindKph ?? 15))),
    },
    rain
      ? {
          icon: 'wet',
          text: rain,
          label: rain === chance ? chance : `Rain: ${rain.toLowerCase()}`,
          // A bare chance is held to the rider's rain limit, when they've set one.
          warn:
            levels.rain !== 'dont-mind' &&
            (rain !== chance ||
              c.maximumPrecipitationProbability >
                (prefs.minimumStandards?.maximumPrecipitationProbability ?? 0)),
        }
      : { icon: 'dry', text: 'Dry', label: 'Dry, no rain', warn: false },
  ];
};
// The sky chip (handoff v4, 18a), between temperature and wind. Sun and sunny intervals get the
// timeline; a mostly cloudy or misty sky keeps its one-word chip, amber only when sunshine is Important.
// Null hides it: sunshine isn't weighed, or no symbol is forecast at all.
export type SkyKind = 'sunny' | 'sunnyIntervals' | 'other' | 'unknown';
export type Sky = Chip & {
  partial?: boolean; // part of the ride isn't forecast yet: the dashed chip
  segments?: { kind: SkyKind; share: number }[]; // ride order, neighbours merged, shares of distance
  legend?: { kind: SkyKind; name: string; share: string }[];
};
const SKY_KINDS = ['sunny', 'sunnyIntervals', 'other', 'unknown'] as const;
const SKY_NAMES: Record<SkyKind, string> = {
  sunny: 'Sunny',
  sunnyIntervals: 'Sunny intervals',
  other: 'Cloud',
  unknown: 'Not forecast yet',
};
const GAP: Record<SkyKind, number> = {
  sunny: 0,
  sunnyIntervals: 0,
  other: 0,
  unknown: 1,
};
// Cloud, overcast, mist, showers and night all count as 'other'.
const skyKinds = (c: Conditions | null): Record<SkyKind, number> | null => {
  const f: SkyShares | null | undefined =
    c?.skyConditionShares ?? c?.skyConditionDistanceFractions;
  if (!f) return null;
  const { sunny = 0, sunnyIntervals = 0, unknown = 0, ...rest } = f;
  const other = Object.values(rest).reduce((a, b) => a + b, 0);
  return { sunny, sunnyIntervals, other, unknown };
};
// ponytail: 10% of the forecast distance makes sun a real part of a mix; below it the ride is mostly intervals.
const REAL_PART = 0.1;
export const approx = (x: number) =>
  x < 0.025 ? '<5%' : `~${Math.round(x * 20) * 5}%`;
export const skyChip = (
  b: Departure,
  sunshine: Levels['sunshine'] = 'nice',
): Sky | null => {
  const assessed = b.sunshineAssessment;
  if (!assessed || assessed.status === 'unavailable') return null;
  // Before skyConditionShares, an hour with a gap has no shares: count it all as not forecast.
  const hours = (b.rideHours ?? []).flatMap((h) =>
    h.conditions?.distanceKm
      ? [{ km: h.conditions.distanceKm, k: skyKinds(h.conditions) ?? GAP }]
      : [],
  );
  const km = hours.reduce((sum, h) => sum + h.km, 0);
  const all =
    skyKinds(b.conditions) ??
    (km
      ? (Object.fromEntries(
          SKY_KINDS.map((kind) => [
            kind,
            hours.reduce((sum, h) => sum + h.k[kind] * h.km, 0) / km,
          ]),
        ) as Record<SkyKind, number>)
      : null);
  if (!all) return null;
  const { sunny, sunnyIntervals, other, unknown } = all;
  const known = sunny + sunnyIntervals + other;
  if (!known) return null;
  if (sunny + sunnyIntervals < other) {
    const f: SkyShares =
      b.conditions.skyConditionShares ??
      b.conditions.skyConditionDistanceFractions ??
      {};
    const cloud = (f.cloudy ?? 0) + (f.overcast ?? 0);
    const fog = f.obscured ?? 0;
    if (!cloud && !fog) return null;
    const text =
      fog > cloud
        ? 'Fog'
        : (f.overcast ?? 0) >= (f.cloudy ?? 0)
          ? 'Overcast'
          : 'Cloudy';
    return {
      icon: fog > cloud ? 'fog' : 'cloud',
      text,
      label: `Sky: ${fog > cloud ? 'fog or mist' : text.toLowerCase()} on ${Math.round(Math.max(cloud, fog) * 100)}% of the route`,
      warn: sunshine === 'important',
    };
  }
  // A rounded share of 1 isn't enough: every ride hour must be sun alone.
  const pure = [all, ...hours.map((h) => h.k)].every(
    (k) => !k.sunnyIntervals && !k.other,
  );
  const partial =
    assessed.status !== 'complete' ||
    assessed.unknownDistanceFraction > 0 ||
    unknown > 0;
  const text = pure
    ? partial
      ? 'Sunny where forecast'
      : 'Sunny throughout'
    : sunny / known < REAL_PART
      ? 'Sunny intervals'
      : sunnyIntervals >= other
        ? 'Sun and sunny intervals'
        : 'Sun and cloud';
  // The order within an hour isn't known: carry on the last colour, then the rest, the gap last.
  const segments: NonNullable<Sky['segments']> = [];
  for (const h of hours.length ? hours : [{ km: 1, k: all }]) {
    const last = segments.at(-1);
    for (const kind of new Set([last?.kind ?? 'sunny', ...SKY_KINDS])) {
      const share = (h.k[kind] * h.km) / (km || 1);
      if (share <= 0) continue;
      const tail = segments.at(-1);
      if (tail?.kind === kind) tail.share += share;
      else segments.push({ kind, share });
    }
  }
  const present = SKY_KINDS.filter((kind) => all[kind] > 0);
  return {
    icon: pure ? 'sun' : 'sunCloud',
    text,
    label: `Sky: ${text.toLowerCase()}${partial && !pure ? ' where forecast' : ''}`,
    warn: false,
    partial,
    segments,
    legend: present.map((kind) => ({
      kind,
      name: SKY_NAMES[kind],
      share: present.length === 1 ? 'Throughout' : approx(all[kind]),
    })),
  };
};

const FAILURES: Record<
  Standard,
  (f: Failure, timeZone: string, u: Units) => string
> = {
  maximumTemperatureC: (f, _, u) =>
    `Reaches ${degrees(f.actual, u)}° (your limit ${degrees(f.limit, u)}°)`,
  maximumGustKph: (f, _, u) =>
    `Gusts reach ${speed(f.actual, u)} (your limit ${speed(f.limit, u)})`,
  maximumPrecipitationProbability: (f) =>
    `${Math.round(f.actual * 100)}% chance of rain (your limit ${Math.round(f.limit * 100)}%)`,
  // ponytail: the first failing section's time; the API doesn't say when the minimum occurs.
  minimumTemperatureC: (f, timeZone, u) =>
    `${degrees(f.actual, u)}° at ${clock(f.sections[0].observedAt, timeZone)} (your limit ${degrees(f.limit, u)}°)`,
  maximumPrecipitationRateMmH: (f) =>
    `Rain reaches ${f.actual} mm/h (your limit ${f.limit} mm/h)`,
};

export type CardState = 'meets' | 'below' | 'incomplete' | 'nofit' | 'pending';
export type Card = {
  routeId: string;
  name: string;
  km: number;
  state: CardState;
  flag: 'Best pick' | 'Best available' | null;
  chip: string; // the Journeys row chip
  when: string | null;
  duration: string | null;
  weather: string | null;
  reason: string | null;
  drawbacks: string[];
  trade: string[];
  coverage: string | null;
  score: number | null;
  best: Departure | null;
  outline: Outline | null; // the route sketch's shape (docs/extension-api-brief-v7.md)
  recent: boolean; // shares roads with recent rides, so scored a little lower
  // docs/extension-api-brief-v13.md: the ride with alerts stays on its time; a better one is offered.
  fixed: TrackedDeparture | null;
  better: Departure | null;
};
export type Banner = 'provider' | 'nomatch' | 'incomplete' | 'distance';
export type Results = {
  status: StandardsStatus;
  cards: Card[];
  banners: Banner[];
  coverageWarn: boolean;
  daylight: Window | null;
};

const STATES: Record<RouteResult['verdict']['status'], CardState> = {
  meets: 'meets',
  below_minimums: 'below',
  doesnt_fit: 'nofit',
  incomplete: 'incomplete',
};

// Cards in the API's order: ranked rides, then those it couldn't rank, then any it hasn't answered for yet.
export const buildResults = (
  routeIds: string[],
  routes: Record<string, RouteSummary>,
  recs: Recommendations | null,
  selected: DaySummary[],
  timeZone: string,
  u: Units = METRIC,
): Results => {
  const list = recs ? [...recs.rankings, ...recs.unranked] : [];
  const byRoute = new Map(list.map((r) => [r.routeId, r]));
  const position = (id: string) => {
    const i = list.findIndex((r) => r.routeId === id);
    return i < 0 ? list.length : i;
  };
  const ids = [...routeIds].sort((a, b) => position(a) - position(b));
  const none = notYet(selected);
  const pick = recs?.recommendation;

  const cards = ids.map((id): Card => {
    const r = byRoute.get(id);
    const route = routes[id];
    const base = {
      routeId: id,
      name: r?.routeName ?? route?.name ?? 'Route',
      km: Math.round(r?.distanceKm ?? (route?.distanceM ?? 0) / 1000),
      flag: null,
      when: null,
      duration: null,
      weather: null,
      reason: null,
      drawbacks: [],
      trade:
        r?.distanceFit?.status === 'below_range'
          ? ['Shorter than your preferred range']
          : r?.distanceFit?.status === 'above_range'
            ? ['Longer than your preferred range']
            : [],
      coverage: null,
      score: null,
      best: null,
      outline: r?.outline ?? null,
      recent: false,
      fixed: r?.trackedDeparture ?? null,
      better: r?.betterDeparture ?? null,
    };
    if (!r)
      return selected.length && none.length === selected.length
        ? {
            ...base,
            state: 'incomplete',
            chip: 'Forecast incomplete',
            reason: `Can't be assessed. ${unavailable(none)}.`,
          }
        : {
            ...base,
            state: 'pending',
            chip: 'Checking…',
            reason: 'Checking the forecast…',
          };
    const state = STATES[r.verdict.status];
    if (r.best) {
      const b = r.best;
      return {
        ...base,
        state,
        flag:
          pick?.routeId === id
            ? pick.kind === 'best_pick'
              ? 'Best pick'
              : 'Best available'
            : null,
        chip:
          state === 'meets'
            ? `${weekday(b.date)} ${dayOfMonth(b.date)} · ${clock(b.departureAt, timeZone)}`
            : state === 'below'
              ? 'Below minimums'
              : 'Forecast incomplete',
        when: `${shortDate(b.date)} · depart ${clock(b.departureAt, timeZone)} · finish ~${clock(b.finishAt, timeZone)}`,
        weather: `At ride time: ${conditionsText(b.conditions, u)}`,
        drawbacks: b.standards.failures.map((f) =>
          FAILURES[f.standard](f, timeZone, u),
        ),
        coverage:
          [
            ...(state === 'incomplete'
              ? ["Partial assessment: some limits couldn't be checked."]
              : []),
            ...(b.sunshineAssessment &&
            b.sunshineAssessment.status !== 'complete'
              ? ['Sunshine is uncertain for this ride.']
              : []),
          ].join(' ') || null,
        score: Math.round(b.score),
        best: b,
        recent:
          b.recentRides?.status === 'assessed' &&
          b.recentRides.penaltyPoints > 0,
      };
    }
    if (state === 'nofit') {
      const w = r.effectiveWindow;
      return {
        ...base,
        state,
        chip: "Doesn't fit window",
        duration: `Estimated ride time ${duration(r.estimatedDurationMinutes)}`,
        reason: w
          ? `Your window, ${clock(w.start, timeZone)}–${clock(w.end, timeZone)}, allows ${duration((Date.parse(w.end) - Date.parse(w.start)) / 60_000)}.`
          : (r.issues[0] ?? null),
      };
    }
    // ponytail: the API drops the whole ride rather than scoring weather alone (docs/extension-api-brief-v2.md).
    const noElevation = r.verdict.code === 'missing_elevation';
    return {
      ...base,
      state: 'incomplete',
      chip: 'Forecast incomplete',
      trade: noElevation
        ? [...base.trade, "No elevation data, so climbing isn't scored"]
        : base.trade,
      reason: noElevation
        ? "Can't be assessed without elevation data while you have a climbing preference."
        : none.length
          ? `Can't be assessed. ${unavailable(none)}.`
          : r.issues.includes('outside-forecast-horizon')
            ? "Can't be assessed. The forecast doesn't cover this ride yet."
            : "Can't be assessed. The forecast is unavailable right now.",
    };
  });

  const status = recs?.minimumStandardsStatus ?? 'not_configured';
  const fits = ids.flatMap((id) => {
    const r = byRoute.get(id);
    return r ? [r.distanceFit] : [];
  });
  const banners: Banner[] = [];
  // The provider itself failed: say so instead of the vaguer 'incomplete'.
  const down = selected.some(
    (d) => d.availabilityReason === 'provider_unavailable',
  );
  if (down) banners.push('provider');
  if (status === 'none_meet') banners.push('nomatch');
  if (status === 'unknown' && !down) banners.push('incomplete');
  if (fits.length && fits.every((f) => f && f.status !== 'within_range'))
    banners.push('distance');
  const sun = selected.find((d) => d.daylight)?.daylight;
  return {
    status,
    cards,
    banners,
    coverageWarn:
      selected.some((d) => d.availability === 'partial') ||
      ids.some((id) => (byRoute.get(id)?.departuresUnknown ?? 0) > 0),
    daylight: sun ? { start: sun.sunrise, end: sun.sunset } : null,
  };
};

// Distance and climbing: typed as text, validated like the design's form.
const MI = 1.609344;
const NUMBER = /^\d*\.?\d+$/;
const oneDecimal = (x: number) => String(Math.round(x * 10) / 10);

export const validateRange = (from: string, to: string, unit: Unit) => {
  const k = unit === 'mi' ? MI : 1;
  const check = (raw: string) => {
    const v = raw.trim();
    if (v === '') return 'Enter a distance.';
    if (v.startsWith('-')) return "Can't be below 0.";
    return NUMBER.test(v) ? null : 'Use numbers only, for example 15 or 22.5.';
  };
  let fromError = check(from);
  let toError = check(to);
  const f = Number.parseFloat(from);
  const t = Number.parseFloat(to);
  if (!toError && t <= 0) toError = 'Must be more than 0.';
  if (!toError && t * k > 400.0001)
    toError = `Can be up to ${unit === 'mi' ? '248.5 mi' : '400 km'}.`;
  if (!fromError && !toError && f > t) fromError = "Can't be more than To.";
  return {
    fromError,
    toError,
    km: fromError || toError ? null : ([f * k, t * k] as [number, number]),
  };
};

export const convert = (value: string, from: Unit, to: Unit) => {
  if (!NUMBER.test(value.trim())) return value;
  const km = Number.parseFloat(value) * (from === 'mi' ? MI : 1);
  return oneDecimal(to === 'mi' ? km / MI : km);
};

export const usualSearch = (p: Preferences, unit: Unit): Search => {
  const k = unit === 'mi' ? MI : 1;
  const [min, max] = p.distance
    ? [p.distance.minKm, p.distance.maxKm]
    : [15, 40];
  return {
    climbing: p.climbing.preference,
    mode: p.distance ? 'range' : 'none',
    from: oneDecimal(min / k),
    to: oneDecimal(max / k),
  };
};

export const searchDiffers = (a: Search, b: Search, unit: Unit) =>
  a.climbing !== b.climbing ||
  a.mode !== b.mode ||
  (a.mode === 'range' &&
    String(validateRange(a.from, a.to, unit).km) !==
      String(validateRange(b.from, b.to, unit).km));

// The per-request override, and the PATCH when saved as usual. An invalid range is left out.
export const searchPatch = (s: Search, unit: Unit): PreferencesPatch => {
  const km = validateRange(s.from, s.to, unit).km;
  return {
    climbing: { preference: s.climbing },
    ...(s.mode === 'none'
      ? { distance: null }
      : km
        ? { distance: { minKm: km[0], maxKm: km[1] } }
        : {}),
  };
};

export const scaleMaxKm = (km: [number, number] | null) =>
  Math.max(120, km ? Math.ceil((km[1] * 1.15) / 10) * 10 : 0);
export const unitLabel = (km: number, unit: Unit) =>
  `${oneDecimal(unit === 'mi' ? km / MI : km)} ${unit}`;

const CLIMBING = { flatter: 'Flatter', neutral: '', hillier: 'Hillier' };
export const rideSummary = (s: Search, unit: Unit) => {
  const km = s.mode === 'range' ? validateRange(s.from, s.to, unit).km : null;
  const text = [
    km
      ? `${oneDecimal(Number.parseFloat(s.from))}–${oneDecimal(Number.parseFloat(s.to))} ${unit}`
      : '',
    CLIMBING[s.climbing],
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    text + (km && s.climbing === 'flatter' ? ': a shorter, gentler ride' : '')
  );
};

// Preferences tab: one flat draft. Limits switched off keep their last value in this browser.
export type Draft = {
  comfortMinC: number;
  comfortMaxC: number;
  headKph: number;
  crossKph: number;
  gustComfortKph: number;
  preferTailwind: boolean;
  floorOn: boolean;
  floorMode: 'fixed' | 'monthly';
  floorFixedC: number;
  floorMonthsC: number[];
  heatOn: boolean;
  heatC: number;
  rainOn: boolean;
  rainPct: number;
  gustOn: boolean;
  gustKph: number;
};

export const draftFrom = (p: Preferences, local: LocalPrefs): Draft => {
  const m = p.minimumStandards;
  const floor = m.minimumTemperature;
  const rain = m.maximumPrecipitationProbability;
  return {
    comfortMinC: p.temperature.comfortMinC,
    comfortMaxC: p.temperature.comfortMaxC,
    headKph: p.wind.comfortableHeadwindKph,
    crossKph: p.wind.comfortableCrosswindKph,
    gustComfortKph: p.wind.comfortableGustKph ?? 35,
    preferTailwind: p.wind.preferTailwind ?? false,
    floorOn: !!floor,
    floorMode: floor?.kind ?? local.floorMode,
    floorFixedC: floor?.kind === 'fixed' ? floor.valueC : local.floorFixedC,
    floorMonthsC:
      floor?.kind === 'monthly'
        ? local.floorMonthsC.map(
            (v, i) => floor.valuesC[String(i + 1)] ?? floor.fallbackC ?? v,
          )
        : local.floorMonthsC,
    heatOn: m.maximumTemperatureC !== undefined,
    heatC: m.maximumTemperatureC ?? local.heatC,
    rainOn: rain !== undefined,
    rainPct: rain !== undefined ? Math.round(rain * 100) : local.rainPct,
    gustOn: m.maximumGustKph !== undefined,
    gustKph: m.maximumGustKph ?? local.gustKph,
  };
};

// Always the full set the tab owns, so the last edit wins. Rain rate isn't on the tab, so it's never sent.
export const draftPatch = (d: Draft): PreferencesPatch => ({
  temperature: { comfortMinC: d.comfortMinC, comfortMaxC: d.comfortMaxC },
  wind: {
    comfortableHeadwindKph: d.headKph,
    comfortableCrosswindKph: d.crossKph,
    comfortableGustKph: d.gustComfortKph,
    preferTailwind: d.preferTailwind,
  },
  minimumStandards: {
    minimumTemperature: !d.floorOn
      ? null
      : d.floorMode === 'fixed'
        ? { kind: 'fixed', valueC: d.floorFixedC }
        : {
            kind: 'monthly',
            valuesC: Object.fromEntries(
              d.floorMonthsC.map((v, i) => [String(i + 1), v]),
            ),
            fallbackC: null,
          },
    maximumTemperatureC: d.heatOn ? d.heatC : null,
    maximumPrecipitationProbability: d.rainOn ? d.rainPct / 100 : null,
    maximumGustKph: d.gustOn ? d.gustKph : null,
  },
});

export const draftLocal = (d: Draft): Partial<LocalPrefs> => ({
  floorMode: d.floorMode,
  floorFixedC: d.floorFixedC,
  floorMonthsC: d.floorMonthsC,
  heatC: d.heatC,
  rainPct: d.rainPct,
  gustKph: d.gustKph,
});

// What the profile looks like once a patch lands; null removes distance or a minimum.
export const applyPatch = (
  p: Preferences,
  patch: PreferencesPatch,
): Preferences => {
  const minimumStandards: Record<string, unknown> = { ...p.minimumStandards };
  for (const [key, value] of Object.entries(patch.minimumStandards ?? {}))
    if (value === null) delete minimumStandards[key];
    else minimumStandards[key] = value;
  return {
    ...p,
    temperature: { ...p.temperature, ...patch.temperature },
    wind: { ...p.wind, ...patch.wind },
    climbing: patch.climbing ?? p.climbing,
    distance: patch.distance === undefined ? p.distance : patch.distance,
    minimumStandards,
    recentRides: patch.recentRides
      ? ({ ...p.recentRides, ...patch.recentRides } as RecentRides)
      : p.recentRides,
  };
};

// The pause, until the moment it turns back on.
export const activePause = (pause: Pause | null, now: Date) =>
  pause && !(pause.resumesAt && Date.parse(pause.resumesAt) <= now.getTime())
    ? pause
    : null;

export const zoneOf = (user: State['user']) =>
  user?.settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

// Everything the popup and page render, from the stored state.
export const viewOf = (state: State, now: Date) => {
  const { user, planning, expired, recs } = state;
  const timeZone = zoneOf(user);
  const today = localDate(now, timeZone);
  const paused = activePause(state.pause, now);
  // An ended window reads as passed until new dates are picked.
  const range = expired ? null : planningDates(planning.days, today);
  const selected = (recs?.days ?? []).filter((d) => range?.includes(d.date));
  const results = buildResults(
    range ? (state.selection?.routeIds ?? []) : [],
    state.routes,
    recs,
    selected,
    timeZone,
    state.units,
  );
  const weather = expired ? state.next?.weather : recs?.weather;
  const at = weather?.retrieval.latestAt;
  const passed =
    expired?.dates ??
    (planning.days.kind === 'dates'
      ? planning.days.dates
      : planning.days.kind === 'range'
        ? span(planning.days.start, planning.days.end)
        : null);
  return {
    timeZone,
    today,
    strip: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      return {
        date,
        ...tile(
          recs?.days.find((d) => d.date === date),
          timeZone,
          state.units,
        ),
      };
    }),
    range,
    passed,
    selected,
    datesText: datesLabel(range ?? passed ?? []),
    timeText: timeText(
      expired ? { ...planning, time: expired.time } : planning,
      results.daylight,
      timeZone,
    ),
    retrieved: at ? clock(at, timeZone) : null,
    provider:
      state.providers.find((p) => p.id === user?.weatherProviderId)?.name ??
      'Your forecast provider',
    paused,
    ...results,
    banners: range && !paused ? results.banners : [],
    // Paused: every tracked ride in tracked order, without scores.
    ...(paused && {
      cards: buildResults(
        state.selection?.routeIds ?? [],
        state.routes,
        null,
        [],
        timeZone,
        state.units,
      ).cards,
      coverageWarn: false,
    }),
  };
};

// The window on screen now, kept so the next open can tell it has ended.
// Alerts moved to another time (handoff v11, 30c): the route shows it, fixed, until the API ranks
// again. Its score and conditions are the API's, from the suggestion or the tile before.
export const pinDeparture = (
  recs: Recommendations,
  routeId: string,
  departure: Departure,
  trackedRideId: string,
): Recommendations => {
  const pin = (r: RouteResult): RouteResult =>
    r.routeId !== routeId || r.best?.departureAt === departure.departureAt
      ? r
      : {
          ...r,
          status: 'assessed',
          best: { ...departure, scoreChange: null },
          trackedDeparture: {
            trackedRideId,
            departureAt: departure.departureAt,
            finishAt: departure.finishAt,
            status: 'assessed',
            reasonCode: null,
          },
          betterDeparture: null,
          verdict: {
            status:
              departure.standards.status === 'below'
                ? 'below_minimums'
                : departure.standards.status === 'unknown'
                  ? 'incomplete'
                  : 'meets',
            code: r.verdict.code,
          },
        };
  return {
    ...recs,
    rankings: recs.rankings.map(pin),
    unranked: recs.unranked.map(pin),
  };
};

export const shownOf = (state: State, now: Date): Shown | null => {
  const { recs } = state;
  if (!recs?.range) return null;
  const view = viewOf({ ...state, expired: null, pause: null }, now);
  const { time } = state.planning;
  const last = recs.range.end;
  const ends = [
    recs.days.find((d) => d.date === last)?.daylight?.sunset,
    time.mode === 'custom' ? instant(last, time.end, recs.timeZone) : null,
  ].flatMap((at) => (at ? [Date.parse(at)] : []));
  return {
    dates: recs.range.dates,
    time,
    endsAt: ends.length
      ? new Date(Math.min(...ends)).toISOString()
      : instant(addDays(last, 1), '00:00', recs.timeZone),
    // Cards with a departure lead, so their order is the pick rank.
    picks: view.cards.flatMap(({ routeId, best }, i): Pick[] =>
      best
        ? [
            {
              routeId,
              date: best.date,
              departureAt: best.departureAt,
              finishAt: best.finishAt,
              conditions: best.conditions,
              rank: i + 1,
            },
          ]
        : [],
    ),
    meta: {
      generatedAt: recs.generatedAt,
      algorithmVersion: recs.algorithmVersion,
      attribution: recs.weather.attribution,
    },
  };
};

export const ended = (shown: Shown, now: Date) =>
  now.getTime() >= Date.parse(shown.endsAt);

// A check-in is settled once one of the window's picks has a ride on its day.
export const logged = (date: string, picks: Pick[], rides: Ride[]) =>
  rides.some(
    (r) => r.riddenOn === date && picks.some((p) => p.routeId === r.routeId),
  );

// What was shown for this route on the check-in day. Null when it wasn't a pick,
// or the API would refuse it (no attribution, or planned after it left).
export const planFor = (checkin: Checkin, routeId: string): RidePlan | null => {
  const pick = checkin.picks.find(
    (p) => p.routeId === routeId && p.date === checkin.date,
  );
  const { meta } = checkin;
  if (
    !pick ||
    !meta.attribution.length ||
    Date.parse(meta.generatedAt) > Date.parse(pick.departureAt)
  )
    return null;
  return {
    schemaVersion: 1,
    departureAt: pick.departureAt,
    finishAt: pick.finishAt,
    conditions: pick.conditions,
    pickRank: pick.rank,
    generatedAt: meta.generatedAt,
    algorithmVersion: meta.algorithmVersion,
    weather: { attribution: meta.attribution },
  };
};

const partOfDay = (time: string) =>
  time < '12:00' ? 'morning' : time < '17:00' ? 'afternoon' : 'evening';

// "This morning, Sat 11 Oct", "Yesterday, Fri 10 Oct" or the date.
export const checkinDay = (pick: Pick, today: string, timeZone: string) => {
  const date = localDate(pick.departureAt, timeZone);
  return date === today
    ? `This ${partOfDay(clock(pick.departureAt, timeZone))}, ${shortDate(date)}`
    : date === addDays(today, -1)
      ? `Yesterday, ${shortDate(date)}`
      : shortDate(date);
};

const SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd' };
const ordinals = new Intl.PluralRules('en-GB', { type: 'ordinal' });
export const rankText = (rank: number | null) =>
  rank === null
    ? 'not a pick'
    : rank === 1
      ? 'your top pick'
      : `your ${rank}${SUFFIX[ordinals.select(rank)] ?? 'th'} pick`;

// "22 Sep", with the year when it isn't this year's.
export const dayMonth = (date: string, today: string) =>
  `${dayOfMonth(date)} ${month(date)}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`}`;
export const monthLabel = (date: string, today: string) =>
  `${longMonthFormat.format(noon(date))}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`}`;

// A route's ride tags: today's from its summary, the last before today from either.
export const ridden = (
  summary: RideSummary | undefined,
  rides: Ride[],
  routeId: string,
  today: string,
) => {
  const latest = summary?.lastRiddenOn ?? null;
  return {
    today: latest === today,
    last:
      latest && latest < today
        ? latest
        : (rides
            .filter((r) => r.routeId === routeId && r.riddenOn < today)
            .map((r) => r.riddenOn)
            .sort()
            .pop() ?? null),
  };
};

// The part of day, only when the whole window lies inside it.
const partOf = ({ start, end }: Window) =>
  end <= '12:00'
    ? ' morning'
    : start >= '17:00'
      ? ' evening'
      : start >= '12:00' && end <= '17:00'
        ? ' afternoon'
        : '';

export const windowName = (w: NextWindow) => {
  if (w.kind === 'best_next_days') return 'Best in the next 6 days';
  const part = w.window === 'daylight' ? '' : partOf(w.window);
  return w.kind === 'tomorrow'
    ? `Tomorrow${part}`
    : `Next ${longWeekday(w.date)}${part}`;
};

// The Rides tab heading: Tomorrow morning, Saturday, This weekend.
export const windowLabel = (
  planning: Planning,
  dates: string[],
  today: string,
) => {
  const preset = planning.days.kind === 'preset' && planning.days.preset;
  const [start] = dates;
  const one = dates.length === 1;
  const day = !one
    ? preset === 'weekend'
      ? 'This weekend'
      : preset === 'next'
        ? 'Next 5 days'
        : 'Your dates'
    : start === today
      ? 'Today'
      : start === addDays(today, 1)
        ? 'Tomorrow'
        : longWeekday(start);
  // A part of the day reads well after one day only: Tomorrow morning, not Next 5 days morning.
  return one && planning.time.mode === 'custom'
    ? day + partOf(planning.time)
    : day;
};

// "Updated just now", then "Updated 5 minutes ago".
export const updatedText = (at: string, now: Date) => {
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'Updated just now';
  const [n, unit] =
    minutes < 60
      ? [minutes, 'minute' as const]
      : minutes < 1440
        ? [Math.floor(minutes / 60), 'hour' as const]
        : [Math.floor(minutes / 1440), 'day' as const];
  return `Updated ${new Intl.RelativeTimeFormat('en-GB').format(-n, unit)}`;
};

// Line 2 of a window card: its dates and times.
export const windowWhen = (
  w: NextWindow,
  after: string,
  today: string,
  timeZone: string,
) => {
  if (w.kind === 'best_next_days')
    return `Any daylight, ${datesLabel(span(addDays(today, 1), addDays(today, 6)))}`;
  const times =
    w.window !== 'daylight'
      ? `${w.window.start}–${w.window.end}`
      : w.effectiveWindow
        ? `${clock(w.effectiveWindow.start, timeZone)}–${clock(w.effectiveWindow.end, timeZone)}`
        : 'Daylight hours';
  const same =
    w.kind !== 'same_weekday'
      ? ''
      : ` · same as ${after === today ? 'today' : after === addDays(today, -1) ? 'yesterday' : shortDate(after)}`;
  return `${shortDate(w.date)} · ${times}${same}`;
};

// Line 3: the top route, its departure and the weather.
export const windowBest = (
  w: NextWindow,
  timeZone: string,
  u: Units = METRIC,
) => {
  const { departureAt, conditions, routeName } = w.best;
  const leave =
    w.kind === 'best_next_days'
      ? `${shortDate(w.date)} ${clock(departureAt, timeZone)}`
      : `leave ${clock(departureAt, timeZone)}`;
  return `${routeName}, ${leave} · ${tempText(conditions, u)} ${rainText(conditions)}`;
};

// Matches GET /rides: newest day first.
export const newest = (a: Ride, b: Ride) =>
  b.riddenOn.localeCompare(a.riddenOn) || a.id.localeCompare(b.id);

// History: "Sat 11 Oct · 35 km". The plan is kept by the API but not shown.
export const rideLine = (ride: Ride) =>
  `${shortDate(ride.riddenOn)} · ${Math.round(ride.route.distanceM / 1000)} km`;

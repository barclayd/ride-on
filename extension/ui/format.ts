// Pure view-model helpers shared by the popup, the Journeys page and the background.
// Type-only imports keep this loadable by `bun test` without wxt/browser.
import type {
  Checkin,
  Days,
  LocalPrefs,
  Pick,
  Planning,
  Preset,
  Search,
  Shown,
  State,
} from '../lib/state';
import type {
  Conditions,
  DaySummary,
  Departure,
  Failure,
  NextWindow,
  Preferences,
  PreferencesPatch,
  RecentRides,
  Recommendations,
  Ride,
  RidePlan,
  RideSummary,
  RouteResult,
  RouteSummary,
  Standard,
  StandardsStatus,
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
const join = (names: string[]) =>
  names.length > 2
    ? `${names[0]} to ${names[names.length - 1]}`
    : names.join(' and ');

export const qualityColour = (score: number) =>
  score >= 75 ? '#8bc61f' : score >= 60 ? '#c9b458' : '#d98b4a';

// A local date and time as a UTC instant.
// ponytail: can be an hour out within an hour of a DST change; fine for "has the window ended".
const instant = (date: string, time: string, timeZone: string) => {
  const guess = new Date(`${date}T${time}:00Z`);
  const local = Date.parse(
    `${localDate(guess, timeZone)}T${clock(guess, timeZone)}:00Z`,
  );
  return new Date(2 * guess.getTime() - local).toISOString();
};

export const PRESETS: [Preset, string][] = [
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['weekend', 'Weekend'],
  ['next', 'Next 5 days'],
];

// The planned dates as the API resolves them (worker/src/recommendations/planning.ts); null once passed.
// Next 5 days starts tomorrow here; the API's starts today, so the background sends it as a range.
export const planningDates = (
  planned: Days,
  today: string,
): [string, string] | null => {
  if (planned.kind === 'range')
    return planned.end < today
      ? null
      : [planned.start < today ? today : planned.start, planned.end];
  if (planned.preset === 'today') return [today, today];
  if (planned.preset === 'tomorrow')
    return [addDays(today, 1), addDays(today, 1)];
  if (planned.preset === 'next') return [addDays(today, 1), addDays(today, 5)];
  const day = noon(today).getUTCDay(); // 0 is Sunday
  if (day === 0) return [today, today];
  const saturday = addDays(today, 6 - day);
  return [saturday, addDays(saturday, 1)];
};

// Click a day: one day, or a range when a different day follows a single-day pick.
export const pickDay = (
  selected: [string, string] | null,
  date: string,
): Days =>
  selected && selected[0] === selected[1] && selected[0] !== date
    ? {
        kind: 'range',
        start: date < selected[0] ? date : selected[0],
        end: date > selected[0] ? date : selected[0],
      }
    : { kind: 'range', start: date, end: date };

export const datesLabel = (start: string, end: string) =>
  start === end
    ? shortDate(start)
    : `${month(start) === month(end) ? `${weekday(start)} ${dayOfMonth(start)}` : shortDate(start)} – ${shortDate(end)}`;

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
  `${join(dates.map(longWeekday))}${dates.length > 1 ? "'s forecasts aren't" : "'s forecast isn't"} available yet`;
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
  if (full.length)
    parts.push(`${join(full.map((d) => longWeekday(d.date)))} available`);
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
export const speed = (kph: number, u: Units) =>
  `${Math.round(u.wind === 'mph' ? kph * 0.621371 : kph)} ${u.wind}`;

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
  icon: 'temperature' | 'wind' | 'dry' | 'wet';
  text: string;
  label: string;
  warn: boolean;
};
export const conditionChips = (
  c: Conditions,
  comfort?: Preferences['temperature'],
  u: Units = METRIC,
): Chip[] => {
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
    {
      icon: 'wind',
      text: kind ? `${shown} ${kind}` : shown,
      label: kind
        ? `${kind[0].toUpperCase()}${kind.slice(1)} ${shown}`
        : `Wind ${shown}`,
      warn: !!kind && kind !== 'tailwind',
    },
    rain
      ? {
          icon: 'wet',
          text: rain,
          label: rain === chance ? chance : `Rain: ${rain.toLowerCase()}`,
          warn: true,
        }
      : { icon: 'dry', text: 'Dry', label: 'Dry, no rain', warn: false },
  ];
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
  recent: boolean; // shares roads with recent rides, so scored a little lower
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
      recent: false,
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

// Everything the popup and page render, from the stored state.
export const viewOf = (state: State, now: Date) => {
  const { user, planning, expired, recs } = state;
  const timeZone =
    user?.settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDate(now, timeZone);
  // An ended window reads as passed until new dates are picked.
  const range = expired ? null : planningDates(planning.days, today);
  const selected = range
    ? (recs?.days ?? []).filter((d) => d.date >= range[0] && d.date <= range[1])
    : [];
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
  const passed: [string, string] | null =
    expired?.dates ??
    (planning.days.kind === 'range'
      ? [planning.days.start, planning.days.end]
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
    datesText: range
      ? datesLabel(...range)
      : passed
        ? datesLabel(...passed)
        : '',
    timeText: timeText(
      expired ? { ...planning, time: expired.time } : planning,
      results.daylight,
      timeZone,
    ),
    retrieved: at ? clock(at, timeZone) : null,
    attributions: weather?.attribution ?? [],
    provider:
      state.providers.find((p) => p.id === user?.weatherProviderId)?.name ??
      'Your forecast provider',
    ...results,
    banners: range ? results.banners : [],
  };
};

// The window on screen now, kept so the next open can tell it has ended.
export const shownOf = (state: State, now: Date): Shown | null => {
  const { recs } = state;
  if (!recs?.range) return null;
  const view = viewOf({ ...state, expired: null }, now);
  const { time } = state.planning;
  const last = recs.range.end;
  const ends = [
    recs.days.find((d) => d.date === last)?.daylight?.sunset,
    time.mode === 'custom' ? instant(last, time.end, recs.timeZone) : null,
  ].flatMap((at) => (at ? [Date.parse(at)] : []));
  return {
    dates: [recs.range.start, last],
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
  [start, end]: [string, string],
  today: string,
) => {
  const preset = planning.days.kind === 'preset' && planning.days.preset;
  const day =
    start !== end
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
  return start === end && planning.time.mode === 'custom'
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
    return `Any daylight, ${datesLabel(addDays(today, 1), addDays(today, 6))}`;
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

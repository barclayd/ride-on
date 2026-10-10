// Pure view-model helpers shared by the popup, the Journeys page and the background.
// Type-only imports keep this loadable by `bun test` without wxt/browser.
import type {
  Days,
  LocalPrefs,
  Planning,
  Preset,
  Search,
  State,
} from '../lib/state';
import type {
  Conditions,
  Departure,
  Failure,
  Preferences,
  PreferencesPatch,
  Recommendations,
  RouteResult,
  RouteSummary,
  Standard,
  StandardsStatus,
  WeatherSource,
  Window,
} from '../lib/types';

type Unit = State['unit'];

const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const utcFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });
const weekdayFormat = utcFormat({ weekday: 'short' });
const longWeekdayFormat = utcFormat({ weekday: 'long' });
const monthFormat = utcFormat({ month: 'short' });

export const weekday = (date: string) => weekdayFormat.format(noon(date));
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
const month = (date: string) => monthFormat.format(noon(date));
const longWeekday = (date: string) => longWeekdayFormat.format(noon(date));
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
const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
const join = (names: string[]) =>
  names.length > 2
    ? `${names[0]} to ${names[names.length - 1]}`
    : names.join(' and ');

export const qualityColour = (score: number) =>
  score >= 75 ? '#8bc61f' : score >= 60 ? '#c9b458' : '#d98b4a';

// ponytail: /weather-providers has names but no horizon yet (docs/extension-api-brief-v2.md),
// so horizons mirror worker/src/weather. Unknown providers get 48h.
const HORIZON_HOURS: Record<string, number> = {
  'apple-weather': 240,
  'met-office': 48,
  'met-office-bpf': 120,
};
export const providerIds = (weather: WeatherSource) =>
  weather.mode === 'strict' ? [weather.providerId] : weather.providerIds;

export type Day = {
  date: string;
  kind: 'full' | 'partial' | 'none';
  until: string | null; // last forecast hour on a partial day
};

// The next seven days and how much of each the forecast horizon covers.
export const availability = (
  now: Date,
  timeZone: string,
  weather: WeatherSource,
): Day[] => {
  const horizon = Math.max(
    ...providerIds(weather).map((id) => HORIZON_HOURS[id] ?? 48),
  );
  const end = new Date(now.getTime() + horizon * 3_600_000);
  const endDate = localDate(end, timeZone);
  const endClock = `${clock(end, timeZone).slice(0, 2)}:00`;
  const today = localDate(now, timeZone);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const kind =
      date < endDate || (date === endDate && endClock >= '21:00')
        ? 'full'
        : date === endDate && endClock > '05:00'
          ? 'partial'
          : 'none';
    return { date, kind, until: kind === 'partial' ? endClock : null };
  });
};

export const PRESETS: [Preset, string][] = [
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['weekend', 'Weekend'],
  ['next', 'Next few days'],
];

export const presetDates = (preset: Preset, days: Day[]): [string, string] => {
  const at = (i: number) => days[Math.min(i, days.length - 1)].date;
  if (preset === 'today') return [at(0), at(0)];
  if (preset === 'tomorrow') return [at(1), at(1)];
  // Five days at most, even when the provider forecasts further (Dan's call).
  const last = days.findLastIndex((d) => d.kind !== 'none');
  if (preset === 'next') return [at(0), at(Math.min(4, Math.max(0, last)))];
  if (weekday(at(0)) === 'Sun') return [at(0), at(0)];
  const saturday = days.findIndex((d) => weekday(d.date) === 'Sat');
  return [at(saturday), at(saturday + 1)];
};

// Presets follow today; picked days are absolute, so null means they've passed.
export const resolveDays = (
  planned: Days,
  days: Day[],
): [string, string] | null => {
  if (planned.kind === 'preset') return presetDates(planned.preset, days);
  const first = days[0].date;
  const last = days[days.length - 1].date;
  if (planned.end < first) return null;
  return [
    planned.start < first ? first : planned.start,
    planned.end > last ? last : planned.end,
  ];
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

const unavailable = (days: Day[]) =>
  `${join(days.map((d) => longWeekday(d.date)))}${days.length > 1 ? "'s forecasts aren't" : "'s forecast isn't"} available yet`;

export const coverageText = (selected: Day[]) => {
  const full = selected.filter((d) => d.kind === 'full');
  const partial = selected.find((d) => d.kind === 'partial');
  const none = selected.filter((d) => d.kind === 'none');
  if (!partial && !none.length) return null;
  const parts = [];
  if (full.length)
    parts.push(`${join(full.map((d) => longWeekday(d.date)))} available`);
  if (partial?.until)
    parts.push(
      `${longWeekday(partial.date)}'s forecast only covers ${partial.until <= '12:00' ? 'the morning' : `up to ${partial.until}`}`,
    );
  if (none.length) parts.push(unavailable(none));
  const text = `${parts.join('; ')}.`;
  return text[0].toUpperCase() + text.slice(1);
};

// The day strip's temperature and quality bar: the best ride that day.
export const daySummary = (recs: Recommendations | undefined) => {
  const bests = (recs?.rankings ?? []).flatMap((r) => (r.best ? [r.best] : []));
  return bests.length
    ? {
        tempC: Math.round(
          Math.max(...bests.map((b) => b.conditions.temperatureC.maximum)),
        ),
        score: Math.round(Math.max(...bests.map((b) => b.score))),
      }
    : null;
};

// Every distinct source shown in these results, once each.
export const attributions = (recs: Recommendations[]) => [
  ...new Map(
    recs
      .flatMap((r) => r.weather.locations)
      .flatMap((l) => l.provenance?.attribution ?? [])
      .map((a) => [a.url, a] as const),
  ).values(),
];

export const retrievedAt = (recs: Recommendations[]) =>
  recs
    .flatMap((r) => r.weather.locations)
    .map((l) => l.provenance?.retrievedAt ?? '')
    .reduce((a, b) => (b > a ? b : a), '') || null;

export const conditionsText = (c: Conditions) => {
  const low = Math.round(c.temperatureC.minimum);
  const high = Math.round(c.temperatureC.maximum);
  const winds: [string, number][] = [
    ['tailwind', c.averageTailwindKph],
    ['headwind', c.averageHeadwindKph],
    ['crosswind', c.averageCrosswindKph],
  ];
  const [kind, speed] = winds.reduce((a, b) => (b[1] > a[1] ? b : a));
  const wind =
    c.averageWindSpeedKph < 5
      ? 'light wind'
      : `${kind} ${Math.round(speed)} km/h`;
  // ponytail: under 10% reads as dry; the card is a summary, the API keeps the detail.
  const rain = Math.round(c.maximumPrecipitationProbability * 100);
  return `${low === high ? high : `${low}–${high}`}° · ${wind} · ${rain < 10 ? 'dry' : `${rain}% rain`}`;
};

const FAILURES: Record<Standard, (f: Failure, timeZone: string) => string> = {
  maximumGustKph: (f) =>
    `Gusts reach ${Math.round(f.actual)} km/h (your limit ${f.limit} km/h)`,
  maximumPrecipitationProbability: (f) =>
    `${Math.round(f.actual * 100)}% chance of rain (your limit ${Math.round(f.limit * 100)}%)`,
  // ponytail: the first failing section's time; the API doesn't say when the minimum occurs.
  minimumTemperatureC: (f, timeZone) =>
    `${Math.round(f.actual)}° at ${clock(f.sections[0].observedAt, timeZone)} (your limit ${f.limit}°)`,
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
};
export type Banner = 'nomatch' | 'incomplete' | 'distance';
export type Results = {
  status: StandardsStatus;
  cards: Card[];
  banners: Banner[];
  coverageWarn: boolean;
  daylight: Window | null;
};

// Mirrors the engine's departure order so merged days rank the way one day would.
const order = (a: Departure, b: Departure) =>
  Number(b.standards.status === 'meets') -
    Number(a.standards.status === 'meets') ||
  b.score - a.score ||
  a.departureAt.localeCompare(b.departureAt);

// ponytail: the API answers one date per request, so the extension merges the selected days.
// One multi-day request would replace this (docs/extension-api-brief-v2.md).
export const buildResults = (
  routeIds: string[],
  routes: Record<string, RouteSummary>,
  selected: Day[],
  recs: Record<string, Recommendations>,
  timeZone: string,
  configured: boolean,
): Results => {
  const fetched = selected.flatMap((d) => (recs[d.date] ? [recs[d.date]] : []));
  const none = selected.filter((d) => d.kind === 'none');
  const byRoute = new Map<string, RouteResult[]>();
  for (const day of fetched)
    for (const r of [...day.rankings, ...day.unranked])
      byRoute.set(r.routeId, [...(byRoute.get(r.routeId) ?? []), r]);
  const best = (r: RouteResult | undefined) => r?.best as Departure;
  const merged = routeIds.map((id) => {
    const results = byRoute.get(id) ?? [];
    const ranked = results
      .filter((r) => r.best)
      .sort((a, b) => order(best(a), best(b)));
    return {
      id,
      results,
      result:
        ranked[0] ??
        results.find((r) => r.status === 'unassessable') ??
        results[0],
    };
  });
  const sorted = [
    ...merged
      .filter((m) => m.result?.best)
      .sort(
        (a, b) =>
          order(best(a.result), best(b.result)) || a.id.localeCompare(b.id),
      ),
    ...merged.filter((m) => m.result && !m.result.best),
    ...merged.filter((m) => !m.result),
  ];

  const statuses = fetched.map((d) => d.minimumStandardsStatus);
  const status: StandardsStatus = !configured
    ? 'not_configured'
    : statuses.includes('match_found')
      ? 'match_found'
      : statuses.includes('unknown') || fetched.length < selected.length
        ? 'unknown'
        : statuses.includes('none_meet')
          ? 'none_meet'
          : 'no_feasible_departure';
  const flag =
    status === 'match_found' || status === 'not_configured'
      ? 'Best pick'
      : status === 'no_feasible_departure'
        ? null
        : 'Best available';

  const cards = sorted.map(({ id, results, result: r }, i): Card => {
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
    if (r.best) {
      const b = r.best;
      const date = localDate(b.departureAt, timeZone);
      const state =
        b.standards.status === 'below'
          ? 'below'
          : b.standards.status === 'unknown'
            ? 'incomplete'
            : 'meets';
      return {
        ...base,
        state,
        flag: i === 0 ? flag : null,
        chip:
          state === 'meets'
            ? `${weekday(date)} ${dayOfMonth(date)} · ${clock(b.departureAt, timeZone)}`
            : state === 'below'
              ? 'Below minimums'
              : 'Forecast incomplete',
        when: `${shortDate(date)} · depart ${clock(b.departureAt, timeZone)} · finish ~${clock(b.finishAt, timeZone)}`,
        weather: `At ride time: ${conditionsText(b.conditions)}`,
        drawbacks: b.standards.failures.map((f) =>
          FAILURES[f.standard](f, timeZone),
        ),
        coverage:
          state === 'incomplete'
            ? "Partial assessment: some minimum conditions couldn't be checked."
            : null,
        score: Math.round(b.score),
      };
    }
    if (results.every((x) => x.status === 'no_feasible_departure')) {
      const w = r.effectiveWindow;
      return {
        ...base,
        state: 'nofit',
        chip: "Doesn't fit window",
        duration: `Estimated ride time ${duration(r.estimatedDurationMinutes)}`,
        reason: w
          ? `Your window, ${clock(w.start, timeZone)}–${clock(w.end, timeZone)}, allows ${duration((Date.parse(w.end) - Date.parse(w.start)) / 60_000)}.`
          : (r.issues[0] ?? null),
      };
    }
    const issues = new Set(results.flatMap((x) => x.issues));
    // ponytail: the API drops the whole ride rather than scoring weather alone (docs/extension-api-brief-v2.md).
    const noElevation = issues.has('missing-elevation');
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
          : issues.has('outside-forecast-horizon')
            ? "Can't be assessed. The forecast doesn't cover this ride yet."
            : "Can't be assessed. The forecast is unavailable right now.",
    };
  });

  const fits = sorted.flatMap((m) => (m.result ? [m.result.distanceFit] : []));
  const banners: Banner[] = [];
  if (status === 'none_meet') banners.push('nomatch');
  if (status === 'unknown') banners.push('incomplete');
  if (fits.length && fits.every((f) => f && f.status !== 'within_range'))
    banners.push('distance');
  const first = fetched[0];
  return {
    status,
    cards,
    banners,
    coverageWarn:
      selected.some((d) => d.kind === 'partial') ||
      sorted.some((m) => (m.result?.departuresUnknown ?? 0) > 0),
    daylight:
      (first && [...first.rankings, ...first.unranked][0]?.daylight) ?? null,
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
    maximumPrecipitationProbability: d.rainOn ? d.rainPct / 100 : null,
    maximumGustKph: d.gustOn ? d.gustKph : null,
  },
});

export const draftLocal = (d: Draft): Partial<LocalPrefs> => ({
  floorMode: d.floorMode,
  floorFixedC: d.floorFixedC,
  floorMonthsC: d.floorMonthsC,
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
  };
};

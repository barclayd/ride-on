// The shortlist panel's text, from the library and `POST /recommendations` (docs/api.md). Pure, so it
// runs in tests; panel.tsx turns it into markup. Formats follow design/gen/proto-logic.js.
import type { LibraryRoute } from './library.ts';

type Precipitation =
  | 'dry'
  | 'possible'
  | 'drizzle'
  | 'light_showers'
  | 'light_rain'
  | 'showers'
  | 'rain'
  | 'heavy_showers'
  | 'heavy_rain'
  | 'sleet'
  | 'snow'
  | 'hail'
  | 'thunder';
export type Conditions = {
  temperatureC: { minimum: number; maximum: number } | null;
  averageWindSpeedKph: number | null;
  precipitationSummary: Precipitation | null;
  skyConditionDistanceFractions: Record<string, number> | null;
};
type Failure = { standard: string; limit: number; actual: number };
export type Best = {
  date: string;
  departureAt: string;
  finishAt: string;
  score: number;
  standards: {
    status: 'meets' | 'below' | 'unknown' | 'not_configured';
    failures: Failure[];
  };
  scoreChange: { by: number } | null;
  conditions: Conditions;
};
export type Ranking = {
  routeId: string;
  routeName: string;
  distanceM: number;
  ascentM: number;
  best: Best | null;
  verdict: {
    status: 'meets' | 'below_minimums' | 'doesnt_fit' | 'incomplete';
    reason: string;
  };
};
export type Recommendations = {
  generatedAt: string;
  timeZone: string;
  recommendation: { routeId: string } | null;
  rankings: Ranking[];
  unranked: Ranking[];
  weather: {
    retrieval: { latestAt: string | null } | null;
    attribution: { text: string; url: string }[];
  } | null;
};

/** Icon names; panel.tsx maps them to lucide SVGs. */
export type IconName =
  | 'thermometer'
  | 'wind'
  | 'sun'
  | 'cloudSun'
  | 'cloud'
  | 'cloudFog'
  | 'moon'
  | 'cloudMoon'
  | 'dropletOff'
  | 'cloudRain'
  | 'cloudDrizzle'
  | 'cloudSnow'
  | 'cloudHail'
  | 'cloudLightning';
export type Chip = { icon: IconName; text: string };
/** meets is the accent tick; close and low are the amber and grey warnings. */
export type Tone = 'meets' | 'close' | 'low';

export const MAX = 12;

/** The band thresholds survive as words only (HANDOFF: identity colours replace the bands). */
export const word = (score: number) => {
  const s = Math.round(score);
  return s >= 75
    ? 'Great'
    : s >= 60
      ? 'Good'
      : s >= 50
        ? 'Fair'
        : 'Not recommended';
};

export const verdictLine = ({
  verdict,
  best,
}: Ranking): { text: string; tone: Tone } => {
  if (verdict.status === 'below_minimums')
    return { text: 'Below your minimums', tone: 'low' };
  if (best?.standards.status === 'unknown')
    return { text: "Couldn't check your minimums", tone: 'close' };
  const s = Math.round(best?.score ?? 0);
  return s >= 60
    ? { text: 'Meets your preferences', tone: 'meets' }
    : s >= 50
      ? { text: 'Close to your preferences', tone: 'close' }
      : { text: 'Not one for today', tone: 'low' };
};

export const km = (m: number) => (m / 1000).toFixed(1);

const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));

/** YYYY-MM-DD in `timeZone`. */
const localDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));

const nextDate = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** Today, Tomorrow, or the weekday, against when the recommendations were made. */
export const dayName = (date: string, recs: Recommendations) => {
  const today = localDate(recs.generatedAt, recs.timeZone);
  if (date === today) return 'Today';
  if (date === nextDate(today)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
};

const span = (best: Best, recs: Recommendations) =>
  `${clock(best.departureAt, recs.timeZone)} → ~${clock(best.finishAt, recs.timeZone)}`;

export const temps = ({ temperatureC: t }: Conditions) => {
  if (!t) return null;
  const [lo, hi] = [Math.round(t.minimum), Math.round(t.maximum)];
  return lo === hi ? `${lo}°` : `${lo}–${hi}°`;
};

const wind = ({ averageWindSpeedKph: w }: Conditions) =>
  w === null ? null : `${Math.round(w)} km/h`;

const SKY: Record<string, Chip | null> = {
  sunny: { icon: 'sun', text: 'Sunny' },
  sunnyIntervals: { icon: 'cloudSun', text: 'Sunny spells' },
  cloudy: { icon: 'cloud', text: 'Cloudy' },
  overcast: { icon: 'cloud', text: 'Overcast' },
  obscured: { icon: 'cloudFog', text: 'Fog' },
  clearNight: { icon: 'moon', text: 'Clear' },
  partlyCloudyNight: { icon: 'cloudMoon', text: 'Partly cloudy' },
  // The rain chip already says it.
  precipitation: null,
};

/** The sky for most of the ride, when the provider reports one. */
const sky = ({ skyConditionDistanceFractions: f }: Conditions) => {
  const [top] = Object.entries(f ?? {}).sort(([, a], [, b]) => b - a);
  return (top && SKY[top[0]]) ?? null;
};

const rainText = (p: Precipitation) =>
  p === 'dry'
    ? 'Dry'
    : p === 'possible'
      ? 'Chance of rain'
      : `${p[0]?.toUpperCase()}${p.slice(1).replaceAll('_', ' ')}`;

const RAIN_ICON: Partial<Record<Precipitation, IconName>> = {
  dry: 'dropletOff',
  drizzle: 'cloudDrizzle',
  sleet: 'cloudSnow',
  snow: 'cloudSnow',
  hail: 'cloudHail',
  thunder: 'cloudLightning',
};

export const chips = (c: Conditions): Chip[] => {
  const [t, w] = [temps(c), wind(c)];
  const list: (Chip | null)[] = [
    t ? { icon: 'thermometer', text: t } : null,
    w ? { icon: 'wind', text: w } : null,
    sky(c),
    c.precipitationSummary && {
      icon: RAIN_ICON[c.precipitationSummary] ?? 'cloudRain',
      text: rainText(c.precipitationSummary),
    },
  ];
  return list.filter((chip): chip is Chip => !!chip);
};

const conditionsLine = (c: Conditions) =>
  [
    temps(c),
    wind(c),
    c.precipitationSummary && rainText(c.precipitationSummary).toLowerCase(),
  ].filter(Boolean);

const failureText = ({ standard, actual }: Failure) => {
  const n = Math.round(actual);
  switch (standard) {
    case 'maximumGustKph':
      return `gusts ${n} km/h`;
    case 'minimumTemperatureC':
      return `low of ${n}°`;
    case 'maximumTemperatureC':
      return `high of ${n}°`;
    case 'maximumPrecipitationRateMmH':
      return `rain ${actual.toFixed(1)} mm/h`;
    case 'maximumPrecipitationProbability':
      return `${Math.round(actual * 100)}% chance of rain`;
    default:
      return standard;
  }
};

export type BestCard = {
  id: string;
  day: string;
  name: string;
  dep: string;
  facts: string;
  score: number;
  word: string;
  chips: Chip[];
  verdict: { text: string; tone: Tone };
};
export type Row = {
  id: string;
  name: string;
  score: string;
  delta: string;
  l1: string;
  l2: string;
  below: string;
};
export type DoesntFit = {
  id: string;
  name: string;
  facts: string;
  reason: string;
};
export type LibraryRow = {
  id: string;
  name: string;
  facts: string;
  src: string;
};

const SOURCES: Record<string, string> = {
  'cycle-travel': 'cycle.travel',
  garmin: 'Garmin Connect',
  strava: 'Strava',
};

export const source = (route: LibraryRoute) =>
  route.source
    ? (SOURCES[route.source.providerId] ?? route.source.providerId)
    : 'GPX upload';

export const libraryFacts = (route: LibraryRoute) => {
  const unpaved = route.surfaceSummary?.unpavedFraction;
  return [
    `${km(route.distanceM)} km`,
    `${Math.round(route.ascentM)} m`,
    ...(unpaved == null ? [] : [`${Math.round(unpaved * 100)}% unpaved`]),
  ].join(' · ');
};

export type PanelInput = {
  routes: LibraryRoute[];
  shortlist: string[];
  recs: Recommendations | null;
  /** Shortlisted routes waiting on their first forecast. */
  checking: ReadonlySet<string>;
  /** The forecast for `checking` failed. */
  recsFailed: boolean;
  query: string;
};

export type Panel = {
  best: BestCard | null;
  rows: Row[];
  doesntFit: DoesntFit[];
  library: LibraryRow[];
  count: string;
  libraryCount: string;
  footer: {
    updated: string;
    attribution: { text: string; url: string }[];
  } | null;
};

/** Everything the panel shows, in the prototype's order: best pick, shortlist, doesn't fit, library. */
export const panel = ({
  routes,
  shortlist,
  recs,
  checking,
  recsFailed,
  query,
}: PanelInput): Panel => {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const name = (id: string, fallback = '') => byId.get(id)?.name ?? fallback;
  const q = query.trim().toLowerCase();
  const match = (id: string, fallback?: string) =>
    !q || name(id, fallback).toLowerCase().includes(q);
  const listed = new Set(shortlist);
  const ranked = (recs?.rankings ?? []).filter(
    (r) => listed.has(r.routeId) && r.best,
  );
  const top =
    ranked.find((r) => r.routeId === recs?.recommendation?.routeId) ??
    ranked[0];
  const best =
    recs && top?.best && match(top.routeId, top.routeName)
      ? {
          id: top.routeId,
          day: dayName(top.best.date, recs),
          name: name(top.routeId, top.routeName),
          dep: span(top.best, recs),
          facts: `↔ ${km(top.distanceM)} km · ${Math.round(top.ascentM)} m climb`,
          score: Math.round(top.best.score),
          word: word(top.best.score),
          chips: chips(top.best.conditions),
          verdict: verdictLine(top),
        }
      : null;

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    seen.add(r.routeId);
    if (r === top || !r.best || !recs || !match(r.routeId, r.routeName))
      continue;
    const by = r.best.scoreChange?.by ?? 0;
    const day =
      top?.best && r.best.date !== top.best.date
        ? `${dayName(r.best.date, recs)} `
        : '';
    rows.push({
      id: r.routeId,
      name: name(r.routeId, r.routeName),
      score: String(Math.round(r.best.score)),
      delta: by > 0 ? `▲ ${by}` : by < 0 ? `▼ ${-by}` : '',
      l1: `${word(r.best.score)} · ${day}${span(r.best, recs)}`,
      l2: [`${km(r.distanceM)} km`, ...conditionsLine(r.best.conditions)].join(
        ' · ',
      ),
      below:
        r.verdict.status === 'below_minimums'
          ? `Below your minimums: ${r.best.standards.failures.map(failureText).join(', ')}`
          : '',
    });
  }
  const doesntFit: DoesntFit[] = [];
  for (const r of recs?.unranked ?? []) {
    if (!listed.has(r.routeId)) continue;
    seen.add(r.routeId);
    if (!match(r.routeId, r.routeName)) continue;
    if (r.verdict.status === 'doesnt_fit')
      doesntFit.push({
        id: r.routeId,
        name: name(r.routeId, r.routeName),
        facts: `${km(r.distanceM)} km · ${Math.round(r.ascentM)} m climb`,
        reason: r.verdict.reason,
      });
    else
      rows.push({
        id: r.routeId,
        name: name(r.routeId, r.routeName),
        score: '–',
        delta: '',
        l1: r.verdict.reason,
        l2: `${km(r.distanceM)} km`,
        below: '',
      });
  }
  // Shortlisted but not in the answer yet: just added, or the forecast failed.
  for (const id of shortlist) {
    const route = byId.get(id);
    if (seen.has(id) || !route || !match(id)) continue;
    if (!checking.has(id) && recs) continue;
    rows.push({
      id,
      name: route.name,
      score: '–',
      delta: '',
      l1: recsFailed ? "Couldn't check the forecast" : 'Checking the forecast…',
      l2: `${km(route.distanceM)} km`,
      below: '',
    });
  }

  const library = routes
    .filter((route) => !listed.has(route.id) && match(route.id))
    .map((route) => ({
      id: route.id,
      name: route.name,
      facts: libraryFacts(route),
      src: source(route),
    }));
  const rest = routes.length - shortlist.length;
  const retrieved = recs?.weather?.retrieval?.latestAt;
  return {
    best,
    rows,
    doesntFit,
    library,
    count: `${shortlist.length} of ${MAX}`,
    libraryCount: `${rest} route${rest === 1 ? '' : 's'}`,
    footer: recs && {
      updated: `Updated ${clock(recs.generatedAt, recs.timeZone)}${retrieved ? ` · forecast retrieved ${clock(retrieved, recs.timeZone)}` : ''}`,
      attribution: recs.weather?.attribution ?? [],
    },
  };
};

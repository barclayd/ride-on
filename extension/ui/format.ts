// Pure view-model helpers shared by the popup and the Journeys page.
import type {
  Climbing,
  Conditions,
  MinimumStandards,
  Planning,
  PlanningDays,
  PreferencesPatch,
  Preset,
  Rain,
  RankedRoute,
  Recommendations,
  RouteSummary,
  Sunshine,
  User,
} from '../lib/types';

const noon = (date: string) => new Date(`${date}T12:00:00Z`);
const utcFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });
const weekdayFormat = utcFormat({ weekday: 'short' });
const monthFormat = utcFormat({ month: 'short' });

export const weekday = (date: string) => weekdayFormat.format(noon(date));
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
export const addDays = (date: string, days: number) =>
  new Date(noon(date).getTime() + days * 86_400_000).toISOString().slice(0, 10);
export const localDate = (at: Date | string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
export const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
export const hours = (iso: string, timeZone: string) => {
  const [h, m] = clock(iso, timeZone).split(':').map(Number);
  return h + m / 60;
};

export const dayLabel = (date: string, today: string) =>
  date === today
    ? 'Today'
    : date === addDays(today, 1)
      ? 'Tomorrow'
      : `${weekday(date)} ${dayOfMonth(date)} ${monthFormat.format(noon(date))}`;

// ponytail: assumes the API's 5-day BPF horizon until the first response lists the real days.
export const horizonDates = (recs: Recommendations | null, today: string) => {
  const days = (recs?.days ?? [])
    .map((day) => day.date)
    .filter((d) => d >= today);
  return days.length
    ? days
    : Array.from({ length: 5 }, (_, i) => addDays(today, i));
};

export const qualityColour = (score: number) =>
  score >= 75 ? '#8bc61f' : score >= 60 ? '#c9b458' : '#d98b4a';

const isWeekend = (date: string) => ['Sat', 'Sun'].includes(weekday(date));

// Mirrors the API's resolvePlanningDays so the strip responds before the API does.
export const resolveDays = (
  days: PlanningDays,
  horizon: string[],
): [string, string] | null => {
  const first = horizon[0];
  const last = horizon[horizon.length - 1];
  if (days.kind === 'range') {
    if (days.end < first) return [first, last];
    const start = days.start < first ? first : days.start;
    const end = days.end > last ? last : days.end;
    return start <= end ? [start, end] : null;
  }
  if (days.preset === 'today') return [first, first];
  if (days.preset === 'tomorrow')
    return horizon[1] ? [horizon[1], horizon[1]] : null;
  if (days.preset === 'next') return [first, last];
  const weekend = horizon.filter(isWeekend);
  return weekend.length ? [weekend[0], weekend[weekend.length - 1]] : null;
};

export const presetAvailable = (preset: Preset, horizon: string[]) =>
  resolveDays({ kind: 'preset', preset }, horizon) !== null;

// Click a day: one day, or a range when a different day follows a single-day pick.
export const pickDay = (
  selected: [string, string] | null,
  date: string,
): PlanningDays =>
  selected && selected[0] === selected[1] && selected[0] !== date
    ? {
        kind: 'range',
        start: date < selected[0] ? date : selected[0],
        end: date > selected[0] ? date : selected[0],
      }
    : { kind: 'range', start: date, end: date };

export const daysLabel = (
  days: PlanningDays,
  horizon: string[],
  today: string,
) => {
  if (days.kind === 'preset')
    return {
      today: 'Today',
      tomorrow: 'Tomorrow',
      weekend: 'This weekend',
      next: `Next ${horizon.length} days`,
    }[days.preset];
  const range = resolveDays(days, horizon);
  if (!range) return 'No days';
  const [start, end] = range;
  return start === end
    ? dayLabel(start, today)
    : `${weekday(start)} ${dayOfMonth(start)} – ${weekday(end)} ${dayOfMonth(end)}`;
};

export const timeLabel = (planning: Planning) =>
  `${planning.window.start}–${planning.window.end}`;

const kph = (value: number) => `${Math.round(value)} km/h`;
export const conditionsLine = (c: Conditions) => {
  const winds: [string, number][] = [
    ['tailwind', c.averageTailwindKph],
    ['headwind', c.averageHeadwindKph],
    ['crosswind', c.averageCrosswindKph],
  ];
  const [kind, speed] = winds.reduce((a, b) => (b[1] > a[1] ? b : a));
  const wind =
    c.averageWindSpeedKph < 5 ? 'light wind' : `${kind} ${kph(speed)}`;
  // ponytail: under 10% reads as dry; the card is a summary, the API keeps the detail.
  const rain = Math.round(c.maximumPrecipitationProbability * 100);
  return `${Math.round(c.temperatureC.maximum)}° · ${wind} · ${rain < 10 ? 'dry' : `${rain}% rain`}`;
};

const PRECIPITATION_CAVEAT = 'Precipitation is possible';
export const pickDrawback = (drawbacks: string[]) =>
  drawbacks.find((d) => d === 'Forecast less certain') ??
  drawbacks.find((d) => !d.startsWith(PRECIPITATION_CAVEAT)) ??
  null;

export type Card = {
  routeId: string;
  name: string;
  state: 'ok' | 'no-ride' | 'pending';
  rankLabel: string; // "Best pick", "#2", "No ride"
  n: string; // rank circle: "1", "2", "!"
  top: boolean;
  day: string;
  window: string;
  conditions: string;
  drawback: string | null;
  reason: string;
  score: number | null;
  confidence: number;
  km: number;
};

export const buildCards = (
  routeIds: string[],
  routes: Record<string, RouteSummary>,
  recs: Recommendations | null,
  timeZone: string,
  today: string,
): Card[] => {
  const byId = new Map<string, RankedRoute>();
  for (const r of [...(recs?.rankings ?? []), ...(recs?.unranked ?? [])])
    byId.set(r.routeId, r);
  const order = (id: string) => {
    const r = byId.get(id);
    if (!r) return 2;
    const ok = r.verdict ? r.verdict.status === 'ride' : r.best !== null;
    return ok ? 0 : 1;
  };
  const rank = (id: string) => {
    const i = recs?.rankings.findIndex((r) => r.routeId === id) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sorted = [...routeIds].sort(
    (a, b) => order(a) - order(b) || rank(a) - rank(b),
  );
  let position = 0;
  return sorted.map((routeId) => {
    const r = byId.get(routeId);
    const route = routes[routeId];
    const name = r?.routeName ?? route?.name ?? 'Route';
    const km = Math.round(r?.distanceKm ?? (route?.distanceM ?? 0) / 1000);
    const base = {
      routeId,
      name,
      top: false,
      day: '',
      window: '',
      conditions: '',
      drawback: null,
      reason: '',
      score: null,
      confidence: 0,
      km,
    };
    if (!r)
      return { ...base, state: 'pending', rankLabel: '…', n: '…' } as Card;
    const ok = order(routeId) === 0 && r.best;
    if (!ok)
      return {
        ...base,
        state: 'no-ride',
        rankLabel: 'No ride',
        n: '!',
        reason:
          r.verdict?.reason ??
          r.issues[0] ??
          'No departure fits the window and daylight.',
      } as Card;
    position++;
    const best = r.best as NonNullable<RankedRoute['best']>;
    return {
      ...base,
      state: 'ok',
      top: position === 1,
      rankLabel: position === 1 ? 'Best pick' : `#${position}`,
      n: String(position),
      day: dayLabel(best.date ?? localDate(best.departureAt, timeZone), today),
      window: `${clock(best.departureAt, timeZone)}–${clock(best.finishAt, timeZone)}`,
      conditions: conditionsLine(best.conditions),
      drawback: pickDrawback(best.drawbacks),
      score: Math.round(best.score),
      confidence: r.confidence ?? 0,
    } as Card;
  });
};

// Preferences tab: the rider edits a flat draft; only changed fields are sent.
export type Draft = {
  comfortMinC: number;
  comfortMaxC: number;
  sunshine: Sunshine | null; // null: custom or not yet offered, so no segment is selected
  rain: Rain | null;
  climbing: Climbing | null;
  windKph: number;
  colderThanC: number;
  rainAbovePct: number;
  gustsAboveKph: number;
};

const level = <T extends string>(value: T | 'custom' | undefined) =>
  value && value !== 'custom' ? value : null;

export const draftFromUser = (user: User, today: string): Draft => {
  const { temperature, wind, minimumStandards: m } = user.settings.preferences;
  const levels = user.preferenceLevels;
  const floor = m.minimumTemperature;
  // ponytail: 0 °C / 70% / 50 km/h mirror the API's default minimums (brief §6) for older profiles.
  const colderThanC =
    floor?.kind === 'monthly'
      ? (floor.valuesC[String(Number(today.slice(5, 7)))] ??
        floor.fallbackC ??
        0)
      : (floor?.valueC ?? 0);
  return {
    comfortMinC: temperature.comfortMinC,
    comfortMaxC: temperature.comfortMaxC,
    sunshine: level(levels?.sunshine),
    rain: level(levels?.rain),
    climbing: levels?.climbing ?? null,
    windKph: levels?.comfortableWindKph ?? wind.comfortableHeadwindKph,
    colderThanC,
    rainAbovePct: Math.round((m.maximumPrecipitationProbability ?? 0.7) * 100),
    gustsAboveKph: m.maximumGustKph ?? 50,
  };
};

export const preferencesPatch = (base: Draft, draft: Draft) => {
  const changed = (key: keyof Draft) => draft[key] !== base[key];
  const levels: NonNullable<PreferencesPatch['preferenceLevels']> = {};
  if (changed('sunshine') && draft.sunshine) levels.sunshine = draft.sunshine;
  if (changed('rain') && draft.rain) levels.rain = draft.rain;
  if (changed('climbing') && draft.climbing) levels.climbing = draft.climbing;
  if (changed('windKph')) levels.comfortableWindKph = draft.windKph;
  const minimums: MinimumStandards = {};
  if (changed('colderThanC'))
    minimums.minimumTemperature = { kind: 'fixed', valueC: draft.colderThanC };
  if (changed('rainAbovePct'))
    minimums.maximumPrecipitationProbability = draft.rainAbovePct / 100;
  if (changed('gustsAboveKph')) minimums.maximumGustKph = draft.gustsAboveKph;
  const patch: PreferencesPatch = {};
  const preferences: NonNullable<PreferencesPatch['preferences']> = {};
  if (changed('comfortMinC') || changed('comfortMaxC'))
    preferences.temperature = {
      comfortMinC: draft.comfortMinC,
      comfortMaxC: draft.comfortMaxC,
    };
  if (Object.keys(minimums).length) preferences.minimumStandards = minimums;
  if (Object.keys(levels).length) patch.preferenceLevels = levels;
  if (Object.keys(preferences).length) patch.preferences = preferences;
  return patch;
};

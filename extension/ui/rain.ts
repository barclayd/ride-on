// "Rain along the ride": the rain chip's panel (handoff v7, 25b). Pure, like format.ts.
// One card per ride hour with its chance and amount, which often disagree, so both always show.
import type { Departure } from '../lib/types';
import { clock } from './format';

const WET_CHANCE = 40; // %: the hour is wet, the chip turns blue
const SMALL_CHANCE = 20; // %: under this every hour, the ride is dry
const LIKELY_CHANCE = 60; // %: the ride's highest chance makes rain likely
// Intensity in mm in the hour: under 0.1 none, under 1 light, under 4 moderate, else heavy.
const LEVELS = [0.1, 1, 4];
const WORDS = ['None', 'Light', 'Moderate', 'Heavy'] as const;
// Sleet, hail, snow and thunder keep their own word over "Rain" or "Drizzle".
const SEVERE: Record<string, string> = {
  sleet: 'Sleet',
  hail: 'Hail',
  snow: 'Snow',
  thunder: 'Thunderstorms',
};

export type RainLevel = 0 | 1 | 2 | 3;
export type RainHour = {
  time: string;
  chance: number; // %
  mm: number;
  level: RainLevel;
  word: (typeof WORDS)[number];
};
export type Rain = {
  text: string; // the chip
  label: string;
  wet: boolean; // some hour reaches 40%: blue
  dry: boolean; // every hour under 20%: the drop gets its slash
  headline: string;
  sentence: string;
  hours: RainHour[];
};

const level = (mm: number) =>
  LEVELS.filter((edge) => mm >= edge).length as RainLevel;

// Null without ride hours: the tile keeps the summary chip.
export const rainPanel = (b: Departure, timeZone: string): Rain | null => {
  const hours: RainHour[] = (b.rideHours ?? []).flatMap((h) => {
    const c = h.conditions;
    if (!c) return [];
    // ponytail: until the API sends the hour's amount (brief v9 §3), its heaviest rate over an hour.
    const mm =
      Math.round(
        (c.maximumPrecipitationAmountMm ?? c.maximumPrecipitationRateMmH ?? 0) *
          10,
      ) / 10;
    const lvl = level(mm);
    return [
      {
        time: clock(h.start, timeZone),
        chance: Math.round(c.maximumPrecipitationProbability * 100),
        mm,
        level: lvl,
        word: WORDS[lvl],
      },
    ];
  });
  if (!hours.length) return null;
  const most = Math.max(...hours.map((h) => h.chance));
  const start = hours.findIndex((h) => h.chance >= WET_CHANCE);
  const dry = start < 0 && most < SMALL_CHANCE;
  if (start < 0) {
    const text = dry ? 'Dry' : 'Small chance of rain';
    return {
      text,
      label: `${text}. Show rain along the ride`,
      wet: false,
      dry,
      headline: dry ? 'Dry ride' : 'Rain unlikely',
      sentence: `Chance of rain stays under ${dry ? SMALL_CHANCE : WET_CHANCE}% for the whole ride.`,
      hours,
    };
  }
  // The first wettest hour.
  const peak = hours.reduce((a, h) => (h.mm > a.mm ? h : a));
  const word =
    SEVERE[b.conditions.precipitationSummary ?? ''] ??
    (peak.mm < 1 ? 'Drizzle' : 'Rain');
  const odds = `${word} ${most >= LIKELY_CHANCE ? 'likely' : 'possible'}`;
  const headline = `${odds} ${start === 0 ? 'from the start' : `from about ${hours[start].time}`}`;
  const easing = hours.findIndex((h, i) => i > start && h.chance < WET_CHANCE);
  const text = `${odds} ${start === 0 ? 'at start' : hours[start].time}`;
  return {
    text,
    label: `${text}. Show rain along the ride`,
    wet: true,
    dry: false,
    headline,
    sentence: `${headline}${easing > 0 ? `, easing by about ${hours[easing].time}` : ' until the finish'}. ${
      peak.level
        ? `Heaviest around ${peak.time}: ${peak.word.toLowerCase()}, ${peak.mm} mm in the hour, ${peak.chance}% chance.`
        : `Under 0.1 mm in any hour, up to ${most}% chance.`
    }`,
    hours,
  };
};

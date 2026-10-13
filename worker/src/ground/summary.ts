import { type GroundHour, HOUR } from './contracts.ts';

export const summarizeHours = (
  hours: readonly GroundHour[],
  endMs: number,
  count: number,
) => {
  const selected = new Map(hours.map((hour) => [Date.parse(hour.end), hour]));
  const summarize = (key: 'rainMm' | 'precipitationMm' | 'referenceEt0Mm') => {
    let availableHours = 0;
    let forecastHours = 0;
    let knownTotal = 0;
    for (let i = 0; i < count; i++) {
      const hour = selected.get(endMs - i * HOUR);
      const value = hour?.[key];
      if (value === null || value === undefined) continue;
      availableHours++;
      knownTotal += value;
      if (hour?.basis === 'forecast') forecastHours++;
    }
    const rounded = Math.round(knownTotal * 1000) / 1000;
    return {
      totalMm: availableHours === count ? rounded : null,
      knownTotalMm: availableHours ? rounded : null,
      availableHours,
      expectedHours: count,
      forecastHours,
    };
  };
  return {
    start: new Date(endMs - count * HOUR).toISOString(),
    end: new Date(endMs).toISOString(),
    rain: summarize('rainMm'),
    precipitation: summarize('precipitationMm'),
    referenceEt0: summarize('referenceEt0Mm'),
  };
};

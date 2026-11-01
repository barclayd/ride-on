/** Stable provider-neutral categorical vocabulary. Codes are identifiers, not scores. */
export const skyConditions = {
  sunny: 1,
  sunnyIntervals: 2,
  cloudy: 3,
  overcast: 4,
  obscured: 5,
  precipitation: 6,
  clearNight: 7,
  partlyCloudyNight: 8,
} as const;

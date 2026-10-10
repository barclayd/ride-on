export const APPLE_NOW = '2026-10-09T12:00:00.000Z';
export const appleWeatherFixture = (
  options: {
    latitude?: number;
    longitude?: number;
    start?: string;
    hours?: number;
    now?: string;
  } = {},
) => {
  const now = Date.parse(options.now ?? APPLE_NOW);
  return {
    forecastHourly: {
      metadata: {
        latitude: options.latitude ?? 51.2,
        longitude: options.longitude ?? -1,
        units: 'm',
        version: 1,
        attributionURL:
          'https://developer.apple.com/weatherkit/data-source-attribution/',
        readTime: new Date(now).toISOString(),
        reportedTime: new Date(now - 3600000).toISOString(),
        expireTime: new Date(now + 3600000).toISOString(),
        temporarilyUnavailable: false,
      },
      hours: Array.from({ length: options.hours ?? 25 }, (_, hour) => ({
        forecastStart: new Date(
          Date.parse(options.start ?? '2026-10-10T00:00:00Z') + hour * 3600000,
        ).toISOString(),
        temperature: 18,
        temperatureApparent: 17,
        windSpeed: 7.2,
        windGust: 14.4,
        windDirection: 180,
        precipitationAmount: 0,
        precipitationChance: 0.08,
        cloudCover: 0.1,
        conditionCode: 'Clear',
        daylight: true,
      })),
    },
  };
};

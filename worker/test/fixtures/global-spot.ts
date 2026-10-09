/** Synthetic values and location, shaped from the verified Global Spot schema.
 * No real forecast, route coordinates, credentials or account identifiers.
 */
export const globalSpotFixture = () => ({
  type: 'FeatureCollection',
  parameters: [
    {
      screenTemperature: { unit: { symbol: { type: 'Cel' } } },
      feelsLikeTemperature: { unit: { symbol: { type: 'Cel' } } },
      windSpeed10m: { unit: { symbol: { type: 'm/s' } } },
      windDirectionFrom10m: { unit: { symbol: { type: 'deg' } } },
      max10mWindGust: { unit: { symbol: { type: 'm/s' } } },
      totalPrecipAmount: { unit: { symbol: { type: 'mm' } } },
      precipitationRate: { unit: { symbol: { type: 'mm/h' } } },
      probOfPrecipitation: { unit: { symbol: { type: '%' } } },
    },
  ],
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1, 52, 50] },
      properties: {
        modelRunDate: '2026-10-09T09:00Z',
        timeSeries: [10, 11, 12].map((hour) => ({
          time: `2026-10-09T${hour}:00Z`,
          screenTemperature: 16,
          feelsLikeTemperature: 14,
          windSpeed10m: 4,
          windDirectionFrom10m: 360,
          max10mWindGust: 7,
          totalPrecipAmount: 0.2,
          precipitationRate: 0.4,
          probOfPrecipitation: 25,
        })),
      },
    },
  ],
});

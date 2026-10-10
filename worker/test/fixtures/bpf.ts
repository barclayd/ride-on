/** Synthetic CoverageJSON: no live forecasts or real route coordinates. */
export const bpfFixture = (
  options: {
    probabilities?: boolean;
    longitude?: number;
    latitude?: number;
    value?: (field: string, hour: number, selection: string) => number | null;
  } = {},
) => {
  const probability =
    'probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt01h';
  const fields = options.probabilities
    ? [
        [
          probability,
          '1',
          'probability_of_lwe_thickness_of_precipitation_amount_above_threshold',
          'time: sum (comment: of lwe_thickness_of_precipitation_amount)',
        ],
      ]
    : [
        ['airTemperature1p5m', 'K', 'air_temperature', ''],
        ['cloudAreaFraction', '1', 'cloud_area_fraction', ''],
        ['windSpeed10m', 'm s-1', 'wind_speed', ''],
        [
          'windFromDirection10mMean',
          'degrees',
          'wind_from_direction',
          'realization: mean',
        ],
        [
          'windSpeedOfGust10mMaximumPt01h',
          'm s-1',
          'wind_speed_of_gust',
          'time: maximum',
        ],
        ['lwePrecipitationRate', 'm s-1', 'lwe_precipitation_rate', ''],
        ['weatherCodePt01h', '1', 'weather_code', ''],
      ];
  const instant = (hour: number) =>
    new Date(
      Date.parse('2026-10-10T00:00:00Z') + hour * 3_600_000,
    ).toISOString();
  const value =
    options.value ??
    ((field: string, _hour: number, selection: string) => {
      if (field === 'weatherCodePt01h') return 3;
      if (field === 'airTemperature1p5m')
        return selection === '50' ? 287.15 : 280;
      if (field === 'cloudAreaFraction') return selection === '50' ? 0.1 : 0.9;
      if (field === 'windFromDirection10mMean') return 180;
      if (field === 'windSpeed10m') return 2;
      if (field === 'windSpeedOfGust10mMaximumPt01h') return 4;
      if (field === probability) return selection === '>0.0' ? 0.08 : 0.01;
      return 0;
    });
  return {
    type: 'CoverageCollection',
    domainType: 'PointSeries',
    referencing: [
      {
        coordinates: ['x', 'y', 'z'],
        system: { id: 'https://www.opengis.net/def/crs/EPSG/0/4979' },
      },
      {
        coordinates: [`${probability}Values`],
        system: {
          label: {
            en: 'probability of lwe thickness of precipitation amount above threshold values (m)',
          },
        },
      },
    ],
    coverages: fields.map(
      ([field = '', unit = '', observed = '', method = '']) => {
        const axis =
          field === probability ? `${probability}Values` : 'percentiles';
        const selections =
          field === probability
            ? ['>0.0', '>1.0E-4']
            : field === 'windFromDirection10mMean' ||
                field === 'weatherCodePt01h'
              ? ['50']
              : ['10', '50', '90'];
        const period =
          method.startsWith('time:') || field === 'weatherCodePt01h';
        return {
          type: 'Coverage',
          id: field,
          parameters: {
            [field]: {
              observedProperty: { label: { en: observed } },
              unit: { symbol: unit },
              custom: {
                ...(method ? { cellMethods: { label: { en: method } } } : {}),
                ...(period ? { timePeriod: { label: { en: 'PT01H' } } } : {}),
              },
            },
          },
          domain: {
            axes: {
              x: { values: [options.longitude ?? -1] },
              y: { values: [options.latitude ?? 51.2] },
              z: { values: [20] },
              locationId: {
                values: [
                  `synthetic:${options.latitude ?? 51.2}:${options.longitude ?? -1}`,
                ],
              },
              t: {
                values: Array.from({ length: 25 }, (_, h) => instant(h)),
                ...(period
                  ? {
                      bounds: Array.from({ length: 25 }, (_, h) => [
                        instant(h - 1),
                        instant(h),
                      ]).flat(),
                    }
                  : {}),
              },
              [axis]: { values: selections },
            },
          },
          ranges: {
            [field]: {
              type: 'NdArray',
              dataType: 'float',
              axisNames: [axis, 't'],
              shape: [selections.length, 25],
              values: selections.flatMap((s) =>
                Array.from({ length: 25 }, (_, h) => value(field, h, s)),
              ),
            },
          },
        };
      },
    ),
  };
};

export const bpfSites = (
  coordinates = [{ latitude: 51.2, longitude: -1 }],
) => ({
  type: 'FeatureCollection',
  features: coordinates.map(({ latitude, longitude }) => ({
    type: 'Feature',
    id: `synthetic:${latitude}:${longitude}`,
    geometry: { type: 'Point', coordinates: [longitude, latitude, 20] },
  })),
});

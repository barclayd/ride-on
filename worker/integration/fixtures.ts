import { HttpResponse, type HttpResponseResolver, http } from 'msw/http';
import { globalSpotFixture } from '../test/fixtures/global-spot.ts';
import { FIXED_NOW } from './harness.ts';

// Kept independent of the adapter's constants so an accidental endpoint change fails.
export const MET_OFFICE_HOURLY =
  'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly';
export const routeGpx = (name: string, longitude = -1, southbound = false) => {
  const latitudes = Array.from({ length: 13 }, (_, i) => 51.2 + i * 0.03);
  if (southbound) latitudes.reverse();
  return `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${latitudes.map((lat) => `<trkpt lat="${lat}" lon="${longitude}"/>`).join('')}</trkseg></trk></gpx>`;
};

type Values = ReturnType<
  typeof globalSpotFixture
>['features'][number]['properties']['timeSeries'][number];
export const hourlyForecast = (
  request: Pick<Request, 'url'>,
  options: {
    values?: (hour: number) => Partial<Omit<Values, 'time'>>;
    firstHour?: number;
    lastHour?: number;
    modelRunDate?: string;
    offsetLatitude?: number;
  } = {},
) => {
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get('latitude'));
  const longitude = Number(url.searchParams.get('longitude'));
  const first = options.firstHour ?? 0;
  const last = options.lastHour ?? 23;
  return {
    type: 'FeatureCollection',
    parameters: globalSpotFixture().parameters,
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            longitude,
            latitude + (options.offsetLatitude ?? 0),
            50,
          ],
        },
        properties: {
          modelRunDate: options.modelRunDate ?? FIXED_NOW,
          timeSeries: Array.from({ length: last - first + 1 }, (_, index) => {
            const hour = first + index;
            return {
              time: `2026-10-10T${String(hour).padStart(2, '0')}:00:00Z`,
              significantWeatherCode: 3,
              screenTemperature: 18,
              feelsLikeTemperature: 17,
              windSpeed10m: 3,
              windDirectionFrom10m: 180,
              max10mWindGust: 4,
              totalPrecipAmount: 0,
              precipitationRate: 0,
              probOfPrecipitation: 0,
              ...options.values?.(hour),
            };
          }),
        },
      },
    ],
  };
};
export const metOffice = (
  resolver: HttpResponseResolver = ({ request }) =>
    HttpResponse.json(hourlyForecast(request)),
) => http.get(MET_OFFICE_HOURLY, resolver);

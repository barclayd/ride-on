import { useState } from 'preact/hooks';
import type { Attribution, ForecastDetails } from '../lib/types';
import { clock, degrees, shortDate, speed, type Units } from './format';

const products: Record<string, string> = {
  'uk-blended-probabilistic-v2': 'Met Office · Blended probabilistic forecast',
  'global-spot-hourly': 'Met Office · Global Spot hourly',
  'weatherkit-hourly': 'Apple Weather · Hourly forecast',
};
const statistic = (
  value: ForecastDetails['locations'][number]['temperatureStatistic'],
) =>
  value?.kind === 'percentile'
    ? ` · ${value.percentile === 50 ? 'median' : `${value.percentile}th percentile`}`
    : '';

export const ForecastEvidence = ({
  details,
  timeZone,
  units,
  attribution,
}: {
  details: ForecastDetails;
  timeZone: string;
  units: Units;
  attribution: Attribution[];
}) => {
  const [selected, setSelected] = useState(0);
  const site = details.locations[selected] ?? details.locations[0];
  if (!site) return null;
  const fetched = (at: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at));
  const datedTime = (at: string) =>
    `${shortDate(new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(at)))} ${clock(at, timeZone)}`;
  return (
    <details class="ro-forecast">
      <summary>Forecast details</summary>
      <div class="ro-forecast-body">
        <p class="ro-forecast-source">
          {products[site.source.productId] ??
            `${site.source.providerId} · ${site.source.productId}`}
        </p>
        {details.locations.length > 1 && (
          <label>
            Forecast location
            <select
              value={selected}
              onChange={(event) =>
                setSelected(Number(event.currentTarget.value))
              }
            >
              {details.locations.map((location, i) => (
                <option key={`${location.sourceLocationId}-${i}`} value={i}>
                  {i + 1}. {location.coordinate.latitude.toFixed(4)},{' '}
                  {location.coordinate.longitude.toFixed(4)}
                </option>
              ))}
            </select>
          </label>
        )}
        <dl>
          <dt>Fetched</dt>
          <dd>{fetched(site.retrievedAt)}</dd>
          <dt>Forecast run</dt>
          <dd>
            {site.forecastRunAt
              ? fetched(site.forecastRunAt)
              : 'Not supplied by provider'}
          </dd>
          <dt>Location</dt>
          <dd>
            {site.coordinate.latitude.toFixed(4)},{' '}
            {site.coordinate.longitude.toFixed(4)}
            {site.sourceLocationId && ` · Site ${site.sourceLocationId}`}
          </dd>
          <dt>Used during</dt>
          <dd>
            {site.routePeriods
              .map(
                (p) => `${clock(p.start, timeZone)}–${clock(p.end, timeZone)}`,
              )
              .join(', ')}
          </dd>
        </dl>
        <p>
          Times in {timeZone}. Temperatures between forecast hours, including
          departure and finish, are estimated by interpolation.
        </p>
        <table>
          <caption>
            Hourly temperatures{statistic(site.temperatureStatistic)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Temperature</th>
            </tr>
          </thead>
          <tbody>
            {site.temperatures.map((sample) => (
              <tr key={sample.at}>
                <th scope="row">{datedTime(sample.at)}</th>
                <td>
                  {sample.celsius === null
                    ? 'Unavailable'
                    : `${degrees(sample.celsius, units)}${units.temperature}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <caption>Hourly gusts{statistic(site.gustStatistic)}</caption>
          <thead>
            <tr>
              <th scope="col">Full forecast period</th>
              <th scope="col">Maximum</th>
            </tr>
          </thead>
          <tbody>
            {site.gusts.map((sample) => (
              <tr key={sample.start}>
                <th scope="row">
                  {datedTime(sample.start)}–{clock(sample.end, timeZone)}
                </th>
                <td>
                  {sample.maximumKph === null
                    ? 'Unavailable'
                    : speed(sample.maximumKph, units)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Gusts apply to the full periods shown, including periods that partly
          overlap your ride. A town forecast may differ from locations along the
          route.
        </p>
        <div class="ro-forecast-credit">
          {attribution.map((credit) => (
            <div key={credit.url}>
              <a href={credit.url} target="_blank" rel="noopener noreferrer">
                {credit.logo ? (
                  <img src={credit.logo.lightUrl} alt={credit.text} />
                ) : (
                  credit.text
                )}
              </a>
              {credit.notice && <p>{credit.notice}</p>}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
};

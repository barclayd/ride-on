import type { Alert } from './policy.ts';

const labels: Record<string, string> = {
  minimumTemperatureC: 'minimum temperature',
  maximumTemperatureC: 'maximum temperature',
  maximumGustKph: 'wind gust',
  maximumPrecipitationProbability: 'rain probability',
  maximumPrecipitationRateMmH: 'rain intensity',
};
const names = (values: string[]) =>
  values.map((v) => labels[v] ?? 'minimum condition').join(', ');
export const pushPayload = (
  alert: Alert,
  plan: {
    id: string;
    routeName: string;
    departureAt: string;
    timeZone: string;
    temperatureUnit?: 'C' | 'F';
  },
  eventId: string,
) => {
  const parts: string[] = [];
  if (alert.reasons.includes('unavailable'))
    parts.push(
      `We can't update your ride assessment.${alert.lastSuccessAt ? ` Last checked ${new Intl.DateTimeFormat('en-GB', { timeZone: plan.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(alert.lastSuccessAt))}.` : ''}`,
    );
  else {
    if (alert.reasons.includes('available_again'))
      parts.push('Ride updates are available again.');
    parts.push(
      `${plan.routeName.slice(0, 100)}: Conditions ${alert.score}/100${alert.scoreDelta && Math.abs(alert.scoreDelta) >= 5 ? ` (${alert.scoreDelta > 0 ? '+' : ''}${alert.scoreDelta})` : ''}.`,
    );
    if (alert.reasons.includes('rain_likely') && alert.rain) {
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: plan.timeZone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(alert.rain.at));
      parts.push(
        `Rain is now likely on ${plan.routeName.slice(0, 100)} (${Math.round(alert.rain.probability * 100)}% at ${time}).`,
      );
    }
    if (alert.reasons.includes('feels_cold') && alert.cold) {
      const degrees = (celsius: number) =>
        `${Math.round(plan.temperatureUnit === 'F' ? (celsius * 9) / 5 + 32 : celsius)}°${plan.temperatureUnit ?? 'C'}`;
      parts.push(
        `${plan.routeName.slice(0, 100)} will feel colder than ${degrees(alert.cold.limitC)} (down to ${degrees(alert.cold.minimumC)}).`,
      );
    }
    if (alert.newlyFailing.length)
      parts.push(`Newly below your limits: ${names(alert.newlyFailing)}.`);
    if (alert.recovered.length)
      parts.push(`Back within your limits: ${names(alert.recovered)}.`);
    if (alert.remainingFailures.length)
      parts.push(`Still below: ${names(alert.remainingFailures)}.`);
    if (alert.alternative) {
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: plan.timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(alert.alternative.departureAt));
      parts.push(
        `A better time for ${alert.alternative.routeName.slice(0, 100)}: ${time} scores ${alert.alternative.score}.`,
      );
    }
  }
  return JSON.stringify({
    aps: {
      alert: {
        title: alert.reasons.includes('evening_summary')
          ? 'Your ride forecast'
          : 'Your ride update',
        body: parts.join(' '),
      },
      sound: 'default',
      'thread-id': plan.id,
    },
    schemaVersion: 1,
    notificationId: eventId,
    trackedRideId: plan.id,
    departureAt: plan.departureAt,
    reasons: alert.reasons,
  });
};

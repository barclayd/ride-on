import { z } from 'zod';

export const FINAL_FORECAST_LOCAL_TIME = '18:00';
export const allAlertTriggers = {
  rain: true,
  wind: true,
  cold: true,
  betterTime: true,
} as const;
export const alertsSchema = z.strictObject({
  triggers: z
    .strictObject({
      rain: z.boolean(),
      wind: z.boolean(),
      cold: z.boolean(),
      betterTime: z.boolean(),
    })
    .refine((triggers) => Object.values(triggers).some(Boolean), {
      message: 'Enable at least one alert trigger.',
    }),
});
export type Alerts = z.infer<typeof alertsSchema>;
export type AlertTriggers = Alerts['triggers'];
export const readAlerts = (json: string | null | undefined): Alerts =>
  json
    ? alertsSchema.parse(JSON.parse(json))
    : { triggers: { ...allAlertTriggers } };

export const standardEnabled = (standard: string, triggers: AlertTriggers) => {
  switch (standard) {
    case 'maximumPrecipitationProbability':
    case 'maximumPrecipitationRateMmH':
      return triggers.rain;
    case 'maximumGustKph':
      return triggers.wind;
    case 'minimumTemperatureC':
      return triggers.cold;
    default:
      return true;
  }
};

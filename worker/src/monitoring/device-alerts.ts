import { z } from 'zod';

export const deviceAlertsSchema = z.strictObject({
  rideAlerts: z.boolean(),
  finalForecast: z.boolean(),
  sound: z.boolean(),
});
export type DeviceAlerts = z.infer<typeof deviceAlertsSchema>;
export type DeviceAlertColumns = {
  ride_alerts?: number;
  final_forecast?: number;
  sound?: number;
};
type AlertDevice = DeviceAlertColumns & { transport?: string };

export const deviceAlerts = (device: DeviceAlertColumns): DeviceAlerts => ({
  rideAlerts: device.ride_alerts !== 0,
  finalForecast: device.final_forecast !== 0,
  sound: device.sound !== 0,
});

export const allowsDeviceAlert = (device: AlertDevice, reasons: string[]) => {
  if (device.transport === 'web_push') return true;
  const alerts = deviceAlerts(device);
  return reasons.some((reason) =>
    reason === 'evening_summary' ? alerts.finalForecast : alerts.rideAlerts,
  );
};

export const devicePayload = (device: AlertDevice, payload: string): string => {
  if (device.transport === 'web_push' || deviceAlerts(device).sound)
    return payload;
  const message = JSON.parse(payload);
  delete message.aps.sound;
  return JSON.stringify(message);
};

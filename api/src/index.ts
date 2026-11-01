import { createApp } from './app.ts';
import { consumeMonitoring, dispatchMonitoring } from './monitoring/service.ts';
import { drainRideWeather } from './rides/learning-service.ts';
import {
  consumeStravaMessage,
  dispatchImports,
} from './strava/import-service.ts';
import { cleanStravaFlows } from './strava/routes.ts';
import type { Env } from './types.ts';

export { createApp } from './app.ts';

const app = createApp();
export default {
  fetch: app.fetch,
  scheduled: async (controller: ScheduledController, env: Env) => {
    await Promise.all([
      dispatchMonitoring(env),
      cleanStravaFlows(env.ROUTES_DB),
      dispatchImports(env),
      drainRideWeather(env, new Date(controller.scheduledTime)),
    ]);
  },
  queue: async (batch: MessageBatch<unknown>, env: Env) => {
    for (const message of batch.messages) {
      try {
        if (await consumeStravaMessage(message.body, env)) message.ack();
        else await consumeMonitoring({ ...batch, messages: [message] }, env);
      } catch {
        message.retry({ delaySeconds: 900 });
      }
    }
  },
} satisfies ExportedHandler<Env>;

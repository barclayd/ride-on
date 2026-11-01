import worker, { createApp } from '../src/index.ts';
import {
  consumeMonitoring,
  dispatchMonitoring,
  jobSchema,
} from '../src/monitoring/service.ts';
import {
  acceptStravaEvent,
  dispatchImports,
  runImportJob,
} from '../src/strava/import-service.ts';
import type { Env } from '../src/types.ts';

// Only time and request logging differ from production. Storage, authentication,
// weather transport, source selection, caching and scoring use real defaults.
export default {
  scheduled: worker.scheduled,
  async fetch(
    request: Request,
    env: Env & { TEST_NOW: string },
    context: ExecutionContext,
  ) {
    const now = () => new Date(env.TEST_NOW);
    if (new URL(request.url).pathname === '/__test/strava-dispatch') {
      const jobs: unknown[] = [];
      await dispatchImports(env, now(), async (messages) => {
        jobs.push(...messages.map((m) => m.body));
      });
      return Response.json({ jobs });
    }
    if (new URL(request.url).pathname === '/__test/strava-event') {
      await acceptStravaEvent(env, await request.json(), now());
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === '/__test/strava-job') {
      const body = (await request.json()) as { id: string };
      await runImportJob(env, body.id, now);
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === '/__test/monitor') {
      const body = jobSchema.parse(await request.json());
      let result = 'unhandled';
      await consumeMonitoring(
        {
          queue: 'ride-monitoring',
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
          messages: [
            {
              body,
              id: 'test',
              timestamp: now(),
              attempts: 1,
              ack: () => {
                result = 'ack';
              },
              retry: () => {
                result = 'retry';
              },
            },
          ],
          ackAll: () => {},
          retryAll: () => {},
        },
        env,
        now,
      );
      return Response.json({ result });
    }
    if (new URL(request.url).pathname === '/__test/dispatch') {
      const jobs: unknown[] = [];
      await dispatchMonitoring(
        {
          ...env,
          RIDE_MONITOR_QUEUE: {
            sendBatch: async (messages: { body: unknown }[]) => {
              jobs.push(...messages.map((m) => m.body));
            },
          } as unknown as Queue,
        },
        now(),
      );
      return Response.json({ jobs });
    }
    return createApp({ now: () => new Date(env.TEST_NOW), log: false }).fetch(
      request,
      env,
      context,
    );
  },
};

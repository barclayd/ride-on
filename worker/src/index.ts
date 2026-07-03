import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { classifyHandler } from './classify.ts';
import { AppError } from './errors.ts';
import { refreshHandler, tokenHandler } from './strava.ts';
import type { Bindings } from './types.ts';

const VERSION = '0.1.0';

const app = new Hono<Bindings>();

// Structured request logging — method, path, status, duration. Never bodies:
// that's where Strava tokens and route coordinates live.
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const { pathname } = new URL(c.req.url);
  console.log(
    `${c.req.method} ${pathname} ${c.res.status} ${Date.now() - start}ms`,
  );
});

app.get('/health', (c) => c.json({ ok: true, version: VERSION }));
app.post('/classify', classifyHandler);
app.post('/strava/token', tokenHandler);
app.post('/strava/refresh', refreshHandler);

app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404),
);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.status as ContentfulStatusCode,
      err.headers,
    );
  }
  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500,
  );
});

export default app;

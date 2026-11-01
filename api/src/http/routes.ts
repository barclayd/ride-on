import { OpenAPIHono, type RouteConfig } from '@hono/zod-openapi';
import type { Handler } from 'hono';
import type { Bindings } from '../types.ts';

/**
 * Existing handlers keep their bounded parsers, coercion and error precedence.
 * One descriptor registers both the real Hono route and its portable contract.
 * New routes can use app.openapi directly when automatic validation is suitable.
 */
export const registerRoute = <R extends RouteConfig>(
  app: OpenAPIHono<Bindings>,
  route: R,
  handler: Handler<Bindings>,
) => {
  app.openAPIRegistry.registerPath(route);
  app.on(route.method, route.path.replace(/\{([^}]+)\}/g, ':$1'), handler);
};

export const createRouter = () => {
  const app = new OpenAPIHono<Bindings>();
  app.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'http',
    scheme: 'bearer',
    description: 'Ride On session token from the browser PKCE handoff.',
  });
  return app;
};

import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { requireApiKey } from '../identity/api-keys.ts';
import { readJsonBody } from '../request.ts';
import type { Bindings } from '../types.ts';
import { type AgentDependencies, createAgentOperations } from './service.ts';

export const agentApiRoutes = (dependencies: AgentDependencies = {}) => {
  const app = new Hono<Bindings>();
  app.post('/agent/v1/:operation', async (c) => {
    const access = await requireApiKey(c.req.raw, c.env);
    const operation = createAgentOperations(
      c.env,
      access.ownerId,
      c.req.raw.signal,
      dependencies,
    ).find((tool) => tool.name === c.req.param('operation'));
    if (!operation)
      throw new AppError(
        404,
        'OPERATION_NOT_FOUND',
        'Unknown agent operation.',
      );
    const missing = operation.requiredScopes.filter(
      (scope) => !access.scopes.includes(scope),
    );
    if (missing.length)
      throw new AppError(
        403,
        'INSUFFICIENT_SCOPE',
        `Required permissions: ${missing.join(', ')}.`,
        {
          'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${operation.requiredScopes.join(' ')}"`,
        },
      );
    const input = await readJsonBody(
      c,
      operation.inputSchema,
      ['add_route', 'score_route_file'].includes(operation.name)
        ? 10_000_000
        : 64_000,
    );
    try {
      return c.json(await operation.run(input));
    } catch (error) {
      // Resolved inputs can still fail date/time-zone validation (for example
      // an ambiguous daylight-saving time), just as they do through MCP.
      if (error instanceof z.ZodError)
        throw new AppError(
          400,
          'INVALID_INPUT',
          'Check the ride date and window.',
        );
      throw error;
    }
  });
  return app;
};

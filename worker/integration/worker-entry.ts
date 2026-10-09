import { createApp } from '../src/index.ts';
import type { Env } from '../src/types.ts';

// Only time and request logging differ from production. Storage, authentication,
// weather transport, source selection, caching and scoring use real defaults.
export default {
  fetch(
    request: Request,
    env: Env & { TEST_NOW: string },
    context: ExecutionContext,
  ) {
    return createApp({ now: () => new Date(env.TEST_NOW), log: false }).fetch(
      request,
      env,
      context,
    );
  },
};

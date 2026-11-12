import { z } from 'zod';
import { AppError } from '../errors.ts';
import { ALGORITHM_VERSION } from '../recommendations/engine.ts';
import { fingerprint } from '../recommendations/fingerprint.ts';
import {
  recommendationWithSettings,
  resolvedRecommendationSchema,
  ridingWindowSchema,
} from '../recommendations/input.ts';
import { preferenceLevels } from '../recommendations/levels.ts';
import { localDate } from '../recommendations/planning.ts';
import { presentRoute } from '../recommendations/presentation.ts';
import {
  type ComparisonContext,
  evaluateComparisons,
} from '../recommendations/service.ts';
import { importRouteFile, routeFileSchema } from '../routes/file.ts';
import type { Route } from '../routes/model.ts';
import {
  createD1RouteStore,
  type RouteStore,
  storedRouteSummary,
} from '../routes/store.ts';
import type { Env } from '../types.ts';
import { createD1UserStore, type UserStore } from '../users/model.ts';

const planning = {
  date: z.iso
    .date()
    .describe('Ride date in the rider’s saved time zone (YYYY-MM-DD).'),
  window: ridingWindowSchema
    .optional()
    .describe(
      'Full-ride window in local time. Defaults to the rider’s saved planning window.',
    ),
  includeReplay: z
    .boolean()
    .default(false)
    .describe(
      'Include the normalised weather, geometry and engine inputs for independent offline replay. Can produce a large result.',
    ),
};
const routeName = z.string().trim().min(1).max(160).optional();
export type AgentDependencies = ComparisonContext['dependencies'] & {
  routeStore?: RouteStore;
  userStore?: UserStore;
  now?: () => Date;
};
export type AgentOperation = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape, z.core.$strict>;
  requiredScopes: readonly string[];
  write: boolean;
  run: (input: unknown) => Promise<Record<string, unknown>>;
};

export const createAgentOperations = (
  env: Env,
  ownerId: string,
  signal: AbortSignal,
  dependencies: AgentDependencies = {},
) => {
  const operations: AgentOperation[] = [];
  const store = dependencies.routeStore ?? createD1RouteStore(env.ROUTES_DB);
  const users = dependencies.userStore ?? createD1UserStore(env.ROUTES_DB);
  const now = dependencies.now ?? (() => new Date());
  const requireUser = async () => {
    const user = await users.get(ownerId);
    if (!user)
      throw new AppError(
        404,
        'USER_NOT_FOUND',
        'Finish setting up your rider profile in Ride On before scoring routes.',
      );
    return user;
  };
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: z.ZodObject<S, z.core.$strict>,
    requiredScopes: string[],
    run: (
      input: z.output<z.ZodObject<S, z.core.$strict>>,
    ) => Promise<Record<string, unknown>>,
    write = false,
  ) => {
    operations.push({
      name,
      description,
      inputSchema,
      requiredScopes,
      write,
      run: (input) => run(inputSchema.parse(input)),
    });
  };
  tool(
    'get_preferences',
    'Read the signed-in rider’s saved preferences, minimum conditions, riding speed, time zone and planning settings. Never accepts a user ID.',
    z.strictObject({}),
    ['preferences:read'],
    async () => {
      const user = await requireUser();
      return {
        displayName: user.displayName,
        version: user.version,
        updatedAt: user.updatedAt,
        settings: user.settings,
        preferenceLevels: preferenceLevels(user.settings.preferences),
      };
    },
  );
  tool(
    'list_routes',
    'List the authorised rider’s saved route library, including route IDs, distances, ascent and source details. Follow nextCursor until null for the complete library.',
    z.strictObject({
      limit: z.number().int().min(1).max(100).default(25),
      cursor: z.uuid().optional(),
    }),
    ['routes:read'],
    async (query) => store.list(ownerId, query),
  );
  tool(
    'add_route',
    'Save a GPX document or base64 FIT activity/course in the rider’s library. This is a persistent change. Identical file bytes and name are deduplicated; it does not select, schedule or log a ride.',
    z.strictObject({ file: routeFileSchema, name: routeName }),
    ['routes:write'],
    async ({ file, name }) => {
      await requireUser();
      const route = await importRouteFile(file, name, now().toISOString());
      const source = {
        // Shared with existing MCP imports for cross-transport deduplication.
        providerId: 'mcp',
        externalId: await fingerprint({
          sourceHash: route.sourceHash,
          name: route.name,
        }),
      };
      const existing = await store.findSource(ownerId, source);
      if (existing)
        return { outcome: 'unchanged', route: storedRouteSummary(existing) };
      const record = { route, source, version: 1, updatedAt: route.createdAt };
      if (await store.createImported(ownerId, record))
        return { outcome: 'created', route: storedRouteSummary(record) };
      const winner = await store.findSource(ownerId, source);
      if (!winner) throw new Error('Route import was not persisted.');
      return { outcome: 'unchanged', route: storedRouteSummary(winner) };
    },
    true,
  );
  const score = async (
    routes: readonly Route[],
    request: z.infer<z.ZodObject<typeof planning>>,
    saved: boolean,
  ) => {
    const user = await requireUser();
    const startedAt = now();
    const today = localDate(startedAt, user.settings.timeZone);
    const daysAhead = today.until(request.date).days;
    if (daysAhead < 0 || daysAhead > 14)
      throw new AppError(
        400,
        'INVALID_RIDE_DATE',
        'Choose today or a date within the next 14 days. Forecast coverage may be shorter.',
      );
    const input = resolvedRecommendationSchema.parse(
      recommendationWithSettings(
        {
          routeIds: routes.map((route) => route.id),
          date: request.date,
          riding: { window: request.window ?? user.settings.planning.window },
        },
        user.settings,
      ),
    );
    const comparison = await evaluateComparisons(routes, [input], input, {
      env,
      ownerId,
      signal,
      now,
      startedAt,
      includeReplay: request.includeReplay,
      // Agent previews must not change the app’s saved comparison baselines.
      dependencies: { ...dependencies, scoreBaselines: async () => new Map() },
    });
    const result = comparison.comparisons[0];
    if (!result) throw new Error('Assessment missing.');
    const evidence = {
      algorithmVersion: ALGORITHM_VERSION,
      revision: env.CF_VERSION_METADATA?.tag || null,
      evaluatedAt: startedAt.toISOString(),
      preferenceVersion: user.version,
      preferenceUpdatedAt: user.updatedAt,
      settings: user.settings,
      resolvedInput: input,
      routes: routes.map((route) => ({
        id: route.id,
        sourceHash: route.sourceHash,
        name: route.name,
        distanceM: route.distanceM,
        ascentM: route.ascentM,
        warnings: route.warnings,
      })),
      weather: comparison.weather,
      history: comparison.history,
      ...(request.includeReplay ? { replay: comparison.replay } : {}),
    };
    return {
      saved,
      scoreRange: { minimum: 0, maximum: 100 },
      recommendation: result.result.recommendedRouteId,
      rankings: result.result.rankings.map((route) =>
        presentRoute(route, input.riding.departureStepMinutes),
      ),
      unranked: result.result.unranked.map((route) =>
        presentRoute(route, input.riding.departureStepMinutes),
      ),
      evidence,
      evidenceSha256: await fingerprint(evidence),
      limitations: [
        'Best means best among the supplied routes and evaluated departure slots.',
        'Forecast conditions can change; recheck at weather.refreshAt. Missing evidence is not proof of suitable conditions.',
        'Scores use the saved riding speed and preferences; they do not certify road safety or route access.',
      ],
    };
  };
  tool(
    'score_routes',
    'Score and compare 1–12 saved routes for a date and full-ride window using the rider’s current preferences and the shared Ride On algorithm. Returns scores, explanations, minimum-condition checks, coverage and forecast evidence.',
    z.strictObject({
      routeIds: z
        .array(z.uuid())
        .min(1)
        .max(12)
        .refine((ids) => new Set(ids).size === ids.length),
      ...planning,
    }),
    ['rides:score', 'preferences:read', 'routes:read'],
    async ({ routeIds, ...request }) => {
      const routes = await store.getMany(ownerId, routeIds);
      if (routes.length !== routeIds.length)
        throw new AppError(
          404,
          'ROUTE_NOT_FOUND',
          'One or more routes were not found in your library.',
        );
      return score(routes, request, true);
    },
  );
  tool(
    'score_route_file',
    'Score a raw GPX document or base64 FIT activity/course without saving it. Use this to evaluate routes discovered elsewhere. Returns the same algorithm, personal preferences, explanations and evidence as saved-route scoring.',
    z.strictObject({ file: routeFileSchema, name: routeName, ...planning }),
    ['rides:score', 'preferences:read'],
    async ({ file, name, ...request }) =>
      score(
        [await importRouteFile(file, name, now().toISOString())],
        request,
        false,
      ),
  );
  return operations;
};

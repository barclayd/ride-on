import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  convertV4MiniflareOptions,
  Miniflare,
  Response as RuntimeResponse,
  type V4MiniflareOptions,
} from 'miniflare';
import { getResponse, type RequestHandler } from 'msw';
import { unstable_splitSqlQuery } from 'wrangler';

export const FIXED_NOW = '2026-10-09T12:00:00.000Z';
export const RIDE_DATE = '2026-10-10';
export const ALICE_TOKEN = 'integration-alice-token-not-a-real-secret';
export const BOB_TOKEN = 'integration-bob-token-not-a-real-secret';
export const WEATHER_KEY = 'integration-met-office-key-not-a-real-secret';
const workerRoot = fileURLToPath(new URL('../', import.meta.url).href);
let bundle: Promise<string> | undefined;
const bundleWorker = () =>
  (bundle ??= build({
    absWorkingDir: workerRoot,
    entryPoints: ['integration/worker-entry.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    external: ['node:*', 'cloudflare:*'],
  }).then((result) => {
    const output = result.outputFiles[0];
    if (!output) throw new Error('Integration Worker did not bundle.');
    return output.text;
  }));

export const createHarness = async (authConfig?: string) => {
  let handlers: RequestHandler[] = [];
  const unexpected: string[] = [];
  const handlerErrors: unknown[] = [];
  const requests: Request[] = [];
  const bindings = {
    AUTH_CONFIG_JSON:
      authConfig ??
      JSON.stringify({
        secret: 'synthetic-session-secret-for-integration-tests-only',
        baseUrl: 'https://api.ride-on.test',
      }),
    TEST_NOW: FIXED_NOW,
    MET_OFFICE_API_KEY: WEATHER_KEY,
    MET_OFFICE_BPF_API_KEY: 'integration-bpf-key-not-a-real-secret',
  };
  const options: V4MiniflareOptions = {
    name: 'ride-on-integration',
    modules: true,
    script: await bundleWorker(),
    compatibilityDate: '2026-10-09',
    compatibilityFlags: ['nodejs_compat'],
    bindings,
    d1Databases: ['ROUTES_DB'],
    kvNamespaces: ['WEATHER_CACHE'],
    cf: {},
    // MSW resolves every actual Worker subrequest. There is deliberately no
    // network fallback: an absent handler fails teardown even if the API catches it.
    outboundService: async (outgoing) => {
      const request = new Request(outgoing.url, {
        method: outgoing.method,
        headers: [...outgoing.headers],
        redirect: outgoing.redirect,
        ...(!['GET', 'HEAD'].includes(outgoing.method)
          ? { body: await outgoing.arrayBuffer() }
          : {}),
      });
      requests.push(request.clone());
      try {
        const response = await getResponse(handlers, request);
        if (!response) {
          unexpected.push(`${request.method} ${request.url}`);
          return new RuntimeResponse('Unhandled integration request', {
            status: 599,
          });
        }
        // Response.error() represents an interrupted connection, not an HTTP 500.
        if (response.type === 'error') return RuntimeResponse.error();
        return new RuntimeResponse(await response.arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers],
        });
      } catch (error) {
        handlerErrors.push(error);
        return new RuntimeResponse('Integration handler failed', {
          status: 599,
        });
      }
    },
  };
  const runtime = new Miniflare(convertV4MiniflareOptions(options));
  try {
    const db = await runtime.getD1Database('ROUTES_DB');
    const migrations = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(fileURLToPath(migrations.href)))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const statements = unstable_splitSqlQuery(
        await readFile(fileURLToPath(new URL(file, migrations).href), 'utf8'),
      );
      await db.batch(statements.map((sql) => db.prepare(sql)));
    }
    // Product scenarios use real, expiring D1 sessions. OAuth scenarios start
    // empty and create their identities through the mocked provider boundary.
    if (authConfig === undefined) {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      for (const [ownerId, token] of [
        ['alice', ALICE_TOKEN],
        ['bob', BOB_TOKEN],
      ]) {
        await db.batch([
          db
            .prepare(
              'INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
            )
            .bind(ownerId, ownerId, `${ownerId}@example.test`, now, now),
          db
            .prepare(
              'INSERT INTO auth_session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .bind(`session-${ownerId}`, ownerId, token, expiresAt, now, now),
          db
            .prepare(
              'INSERT INTO auth_user_owners (auth_user_id, owner_id) VALUES (?, ?)',
            )
            .bind(ownerId, ownerId),
        ]);
      }
    }
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  return {
    runtime,
    requests,
    unexpected,
    handlerErrors,
    use: (...next: RequestHandler[]) => {
      handlers = next;
    },
    restart: async (overrides: Partial<typeof bindings> = {}) => {
      Object.assign(bindings, overrides);
      await runtime.setOptions(
        convertV4MiniflareOptions({ ...options, bindings }),
      );
    },
    send: async (
      path: string,
      init: {
        method?: string;
        body?: string;
        contentType?: string;
        token?: string | null;
        headers?: Record<string, string>;
      } = {},
    ) =>
      runtime.dispatchFetch(new URL(path, 'https://api.ride-on.test').href, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: {
          ...(init.token === null
            ? {}
            : { Authorization: `Bearer ${init.token ?? ALICE_TOKEN}` }),
          'Content-Type': init.contentType ?? 'application/json',
          ...init.headers,
        },
        body: init.body,
        redirect: 'manual',
      }),
    dispose: () => runtime.dispose(),
  };
};
export type Harness = Awaited<ReturnType<typeof createHarness>>;

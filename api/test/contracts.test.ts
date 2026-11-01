import { describe, expect, test } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { createApp } from '../src/app.ts';
import { AppError } from '../src/errors.ts';
import { libraryRoutes } from '../src/http/library.ts';
import { createRouter, registerRoute } from '../src/http/routes.ts';
import { defaultSettings } from '../src/recommendations/input.ts';
import { readJsonBody } from '../src/request.ts';
import {
  errorSchema,
  pauseSchema,
  selectionResponseSchema,
  userResponseSchema,
} from '../src/schemas/library.ts';
import { updateSelectionSchema } from '../src/schemas/selection.ts';

const document = createApp({ log: false }).getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Ride On', version: 'test' },
});
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validator = (name: string) =>
  ajv.compile({
    $ref: `#/components/schemas/${name}`,
    components: document.components,
  });

describe('portable wire contracts', () => {
  test('nullable named references keep null without weakening the shared schema', () => {
    const validate = validator('UserResponse');
    const user = {
      schemaVersion: 1,
      id: 'contract-user',
      version: 1,
      displayName: 'Contract rider',
      createdAt: '2026-10-14T12:00:00.000Z',
      updatedAt: '2026-10-14T12:00:00.000Z',
      settings: defaultSettings,
      weatherProviderId: null,
      preferenceLevels: {
        sunshine: 'medium',
        rain: 'medium',
        crosswind: 'medium',
      },
    };
    const pause = { until: null, resumesAt: null, pausedAt: user.createdAt };
    for (const value of [null, pause]) {
      const response = { user: { ...user, pause: value } };
      expect(userResponseSchema.safeParse(response).success).toBe(true);
      expect(validate(response)).toBe(true);
    }
    for (const invalid of [user, { ...user, pause: false }]) {
      expect(userResponseSchema.safeParse({ user: invalid }).success).toBe(
        false,
      );
      expect(validate({ user: invalid })).toBe(false);
    }
    expect(pauseSchema.safeParse(pause).success).toBe(true);
    expect(validator('Pause')(pause)).toBe(true);
    expect(pauseSchema.safeParse(null).success).toBe(false);
    expect(validator('Pause')(null)).toBe(false);
  });

  test('null is accepted only where declared and required keys stay required', async () => {
    const validate = validator('SelectionResponse');
    for (const name of ['selection-empty', 'selection-saved']) {
      const fixture = JSON.parse(
        await Bun.file(
          new URL(`../contracts/fixtures/${name}.json`, import.meta.url),
        ).text(),
      );
      expect(selectionResponseSchema.safeParse(fixture).success).toBe(true);
      expect(validate(fixture)).toBe(true);
    }
    for (const fixture of [
      null,
      {},
      { selection: null },
      { selection: { version: 0, routeIds: [] } },
      { selection: { version: -1, routeIds: [], updatedAt: null } },
    ]) {
      expect(selectionResponseSchema.safeParse(fixture).success).toBe(false);
      expect(validate(fixture)).toBe(false);
    }
    const error = JSON.parse(
      await Bun.file(
        new URL('../contracts/fixtures/error-conflict.json', import.meta.url),
      ).text(),
    );
    expect(errorSchema.safeParse(error).success).toBe(true);
    expect(validator('Error')(error)).toBe(true);
  });

  test('all documented operations point to registered HTTP handlers', () => {
    const app = createApp({ log: false });
    for (const route of Object.values(libraryRoutes)) {
      const path = route.path.replace(/\{([^}]+)\}/g, ':$1');
      expect(
        app.routes.some(
          (r) => r.method === route.method.toUpperCase() && r.path === path,
        ),
      ).toBe(true);
    }
  });
});

// Exercise the exact route registration/parser bridge without storage or real sessions.
const parserApp = () => {
  const app = createRouter();
  app.onError((error, c) => {
    if (!(error instanceof AppError)) throw error;
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as 400,
    );
  });
  registerRoute(app, libraryRoutes.updateSelection, async (c) => {
    const input = await readJsonBody(c, updateSelectionSchema, 128);
    return c.json({
      selection: {
        version: input.expectedVersion + 1,
        routeIds: input.routeIds,
        updatedAt: null,
      },
    });
  });
  return app;
};

test('registered JSON routes preserve media, UTF-8, byte limits and schema errors', async () => {
  const app = parserApp();
  const request = (body: BodyInit, type = 'application/json') =>
    app.request('/route-selection', {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body,
    });
  expect((await request('{"expectedVersion":0,"routeIds":[]}')).status).toBe(
    200,
  );
  for (const [body, type, status, code] of [
    ['{}', 'text/plain', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['{', 'application/json', 400, 'BAD_REQUEST'],
    [' '.repeat(129), 'application/json', 413, 'BODY_TOO_LARGE'],
    [
      '{"expectedVersion":0,"routeIds":[],"surprise":true}',
      'application/json',
      400,
      'BAD_REQUEST',
    ],
  ] as const) {
    const response = await request(body, type);
    expect(response.status).toBe(status);
    expect(errorSchema.parse(await response.json()).error.code).toBe(code);
  }
  const invalidUtf8 = await request(new Uint8Array([0xff, 0xfe]));
  expect(invalidUtf8.status).toBe(400);
  expect(errorSchema.parse(await invalidUtf8.json()).error.message).toBe(
    'Request body must be valid JSON',
  );
  // Keep the old parser's accepted JSON media spelling; registration must not narrow it.
  expect(
    (
      await request(
        '{"expectedVersion":0,"routeIds":[]}',
        'application/json; charset=utf-8',
      )
    ).status,
  ).toBe(200);
});

test('authentication still wins over malformed input', async () => {
  const app = createApp({
    log: false,
    resolveAccess: async () => {
      throw new AppError(401, 'UNAUTHENTICATED', 'Sign in');
    },
  });
  const response = await app.request(
    '/route-selection',
    { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{' },
    {},
  );
  expect(response.status).toBe(401);
  expect(errorSchema.parse(await response.json()).error.code).toBe(
    'UNAUTHENTICATED',
  );
});

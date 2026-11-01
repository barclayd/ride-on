import { createRoute, z } from '@hono/zod-openapi';
import {
  errorSchema,
  geometryResponseSchema,
  healthSchema,
  importResponseSchema,
  routeListSchema,
  routeResponseSchema,
  selectionResponseSchema,
  sourcesResponseSchema,
  surfaceResponseSchema,
  userResponseSchema,
} from '../schemas/library.ts';
import {
  listRoutesSchema,
  pauseInputSchema,
} from '../schemas/library-input.ts';
import { importRouteSchema } from '../schemas/route-sources.ts';
import { updateSelectionSchema } from '../schemas/selection.ts';
import { createUserSchema, updateUserSchema } from '../schemas/users.ts';

const json = <S extends z.ZodType>(schema: S, description = 'Success') => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <S extends z.ZodType>(schema: S) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const errors = {
  400: json(errorSchema, 'Invalid input'),
  401: json(errorSchema, 'Session required'),
  403: json(errorSchema, 'Forbidden'),
  404: json(errorSchema, 'Resource not found'),
  409: json(errorSchema, 'Version conflict'),
  413: json(errorSchema, 'Body too large'),
  415: json(errorSchema, 'Unsupported media type'),
  422: json(errorSchema, 'Invalid operation'),
  429: json(errorSchema, 'Rate limited'),
  500: json(errorSchema, 'Internal error'),
};
const security = [{ session: [] }];
const params = z.object({ id: z.uuid() });
export const libraryRoutes = {
  health: createRoute({
    method: 'get',
    path: '/health',
    operationId: 'health',
    responses: { 200: json(healthSchema) },
  }),
  createUser: createRoute({
    method: 'post',
    path: '/users',
    operationId: 'createUser',
    security,
    request: { body: body(createUserSchema) },
    responses: { 201: json(userResponseSchema), ...errors },
  }),
  user: createRoute({
    method: 'get',
    path: '/users/me',
    operationId: 'getUser',
    security,
    responses: { 200: json(userResponseSchema), ...errors },
  }),
  updateUser: createRoute({
    method: 'patch',
    path: '/users/me',
    operationId: 'updateUser',
    security,
    request: { body: body(updateUserSchema) },
    responses: { 200: json(userResponseSchema), ...errors },
  }),
  pause: createRoute({
    method: 'put',
    path: '/users/me/pause',
    operationId: 'pause',
    security,
    request: { body: body(pauseInputSchema) },
    responses: { 200: json(userResponseSchema), ...errors },
  }),
  resume: createRoute({
    method: 'delete',
    path: '/users/me/pause',
    operationId: 'resume',
    security,
    responses: { 200: json(userResponseSchema), ...errors },
  }),
  selection: createRoute({
    method: 'get',
    path: '/route-selection',
    operationId: 'getSelection',
    security,
    responses: { 200: json(selectionResponseSchema), ...errors },
  }),
  updateSelection: createRoute({
    method: 'put',
    path: '/route-selection',
    operationId: 'updateSelection',
    security,
    request: { body: body(updateSelectionSchema) },
    responses: { 200: json(selectionResponseSchema), ...errors },
  }),
  sources: createRoute({
    method: 'get',
    path: '/route-sources',
    operationId: 'getSources',
    security,
    responses: { 200: json(sourcesResponseSchema), ...errors },
  }),
  import: createRoute({
    method: 'post',
    path: '/route-imports',
    operationId: 'importRoute',
    security,
    request: { body: body(importRouteSchema) },
    responses: {
      200: json(importResponseSchema),
      201: json(importResponseSchema),
      ...errors,
    },
  }),
  routes: createRoute({
    method: 'get',
    path: '/routes',
    operationId: 'getRoutes',
    security,
    request: { query: listRoutesSchema },
    responses: { 200: json(routeListSchema), ...errors },
  }),
  route: createRoute({
    method: 'get',
    path: '/routes/{id}',
    operationId: 'getRoute',
    security,
    request: { params },
    responses: { 200: json(routeResponseSchema), ...errors },
  }),
  geometry: createRoute({
    method: 'get',
    path: '/routes/{id}/geometry',
    operationId: 'getRouteGeometry',
    security,
    request: { params },
    responses: { 200: json(geometryResponseSchema), ...errors },
  }),
  surface: createRoute({
    method: 'get',
    path: '/routes/{id}/surface',
    operationId: 'getRouteSurface',
    security,
    request: { params },
    responses: { 200: json(surfaceResponseSchema), ...errors },
  }),
  upload: createRoute({
    method: 'post',
    path: '/routes',
    operationId: 'uploadRoute',
    security,
    request: {
      body: {
        required: true,
        content: {
          'application/gpx+xml': {
            schema: {
              type: 'string',
              description: 'UTF-8 GPX, at most 5,000,000 bytes',
            },
          },
          'application/xml': { schema: { type: 'string' } },
          'text/xml': { schema: { type: 'string' } },
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    },
    responses: { 201: json(routeResponseSchema), ...errors },
  }),
};

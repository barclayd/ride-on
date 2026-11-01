# Wire contracts

The API continues to run on Cloudflare Workers with Bun tooling. It retains its
D1/KV/R2/Queues, service bindings, production IDs, migrations and compatibility
date. This change moves source from `worker/` to `api/`; it does not change the
public service URL or deploy resources.

## Generated coverage

`bun run contracts:generate` produces `contracts/openapi.json`, the type-only
`contracts/client.d.ts`, `contracts/coverage.json`, and copies the synthetic
fixtures into the Swift Networking test bundle. `bun run contracts:check`
validates OpenAPI 3.1 with Swagger Parser, runs the intended TypeScript generator
and rejects stale output. It is part of `bun run check`.

The generated contract currently covers 15 operations: health; create/read/edit
profile; pause/resume; read/edit shortlist; source discovery; GPX import/upload;
library listing; route detail, surface and geometry reads. `coverage.json`
derives its documented and remaining-handler lists from the actual app/router.
It is not a claim that all existing API operations are described by OpenAPI.

Recommendation, tracking, history, push and integration endpoints retain their
existing handlers, validators and protocol documentation. Better Auth owns its
`/api/auth/*` protocol. Their next contract extraction should preserve those
boundaries rather than representing them as unconstrained generated DTOs.
See [the API reference](../../docs/api.md), [authentication](../../docs/authentication.md),
[tracking](../../docs/ride-tracking-api.md) and [Strava](../../docs/strava.md).

## Registration and validation

`createRoute` descriptors are passed to `registerRoute`, which registers both
OpenAPI metadata and the actual method/path/handler on OpenAPIHono. Existing
handlers still use `readJsonBody`/`validateInput` with the **same schema instance**
used in the descriptor. This deliberately retains bounded byte reads, fatal
UTF-8 handling, media checks and existing error messages; it does not add a
second automatic JSON read. Queries preserve the existing first-value semantics.
Authenticated middleware remains before parsing. Raw/multipart GPX keeps its
original 5 MB/5.1 MB limits and XML-specific validation. JSON route imports keep
the 6 MB outer limit; ordinary JSON bodies keep the 64 KB default.

Response types are not automatically runtime-validated by Hono. The real
Workers/D1 integration harness validates covered responses against their
registered Zod schemas. The contract tests also validate portable JSON Schema,
including null/omitted required keys, numeric bounds and error envelopes. All
300 existing integration scenarios remain relevant, including endpoints outside
the new generated contract.

With `@hono/zod-openapi` 1.6.3, `.nullable()` on the named `Pause` schema
widens the shared component. `User.pause` uses an explicit union with null so
only that property accepts null. A Zod/JSON Schema regression checks both the
nullable property and the non-null shared component.
The strict surface-evidence schema reuses `SurfaceInput`'s shape instead of
extending its named component: generated `allOf` cannot add properties to a
component that forbids additional properties. Both null and populated evidence
are covered by the same parity checks.

Schemas under `src/schemas` contain only shape dependencies. Keep storage,
provider calls and HTTP composition above them. The route registry must not
import service implementations just to obtain a request schema: consumers and
generators need the schemas without starting Workers-only code.

## Compatibility semantics

- Session tokens stay in the established bearer/cookie flow. A successful API
  response may rotate `set-auth-token`; clients keep login/account identity
  separate from the token. A late response must not restore a signed-out account.
- Error envelopes remain `{ "error": { "code": "…", "message": "…" } }` with
  their existing HTTP statuses and retry headers. Authentication failure still
  takes precedence over a malformed protected request.
- IDs remain strings. Route UUIDs retain their lowercase API representation;
  upstream source IDs are decimal strings, never JavaScript numbers.
- UTC instants are ISO 8601 strings; local riding dates and pause-until dates are
  civil dates resolved in the saved time zone. A null pause-until means an
  indefinite pause; it is distinct from deleting the pause.
- Patches preserve omitted/null/default meanings and strict unknown-field
  rejection. Preference refinements and pause-date ranges include semantic
  checks OpenAPI alone cannot express.
- Selection and profile edits keep optimistic version checks and conflict
  responses. Schema extraction does not add retries to non-idempotent writes.
- Current selection responses require `updatedAt`, accepting explicit null for
  an empty initial selection. Swift remains tolerant of its omission in older
  client/cache payloads. Generated server contracts and client persistence are
  separate lifecycles.

The extension uses generated selection/surface types. The web app derives the
selection fields it displays from those declarations. Other hand-written client
adapters are projections of their older supported API surface, not alternate
server schema authorities. Do not remove tolerant fields from them merely to
match the latest required output.

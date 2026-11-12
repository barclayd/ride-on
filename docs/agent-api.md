# Account API keys and agent HTTP API

API v0.46.0 exposes the five [MCP tools](mcp.md) as ordinary JSON HTTP endpoints
at `https://api.ride-on.cc/agent/v1/`. They use the same validation, saved rider
preferences, route import service, scoring algorithm and replay evidence as MCP.
There are no new account screens or changes to the existing apps.

## Create, list and revoke keys

Sign into the existing Ride On account that owns your preferences and routes.
Account creation/sign-in continues through the existing Apple, Google or passkey
[authentication APIs](authentication.md); there is no anonymous API-key signup,
separate agent account, or caller-selected rider ID.

The following backend operations use an **account session**, either Bearer or
the existing browser cookie. API keys and MCP OAuth tokens cannot manage keys.
Cookie-authenticated changes require the trusted `Origin` header. A failed
explicit Bearer credential never falls back to a valid session cookie.

| Method and path | Request | Result |
| --- | --- | --- |
| `POST /auth/api-keys` | `name`, `scopes`, optional `expiresInDays` | `201`, key secret once plus metadata |
| `GET /auth/api-keys` | Optional `limit` (1–100, default 25), `cursor` | `{keys, nextCursor}`; metadata only, including revoked/expired keys |
| `DELETE /auth/api-keys/{id}` | No body | `204`, immediately revokes the caller's key; repeat revocation is safe |

Creation requires a session created within the last **10 minutes**. Sign in again
if it returns `403 RECENT_LOGIN_REQUIRED`. Revocation accepts any active account
session so it remains accessible without another sign-in. List and revoke are
scoped to the signed-in account; another account's key ID returns `404`.

Example creation body:

```json
{
  "name": "Al",
  "scopes": ["preferences:read", "routes:read", "rides:score"],
  "expiresInDays": 90
}
```

Add `routes:write` when the agent should also save routes. Scope names are the
same as MCP; `offline_access` is not an API-key scope. Names are 1–80 characters;
scopes must be a nonempty, unique list of the four supported permissions.
Expiry defaults to **90 days**, with a range of 1–365 days and a maximum of
**20 active keys** per account. Keys cannot extend themselves or change scopes.
Rotate by creating a replacement, updating the agent's secret store, verifying
it, then revoking the old key.

Creation returns `key`, `id`, `name`, `prefix`, `scopes`, `createdAt`, `expiresAt`,
`revokedAt` and `lastUsedAt`. Only creation includes `key`. A key has 256 random
bits and the `ro_agent_` prefix; D1 stores only its SHA-256 hash and a short
identifying prefix. List results omit the secret and hash. All responses use
`Cache-Control: no-store`. Revoking the account's app session does not revoke
its independently issued API keys; revoke the keys explicitly when required.

## Internal command

From `api/`, use the internal command with a private file containing an existing
account session token from the normal sign-in flow. Keep the file outside the
repository and set its permissions to `600`. Do not give this session to the
agent. The command does not read credentials from browser storage or print them.

```sh
bun scripts/agent-keys.ts create \
  --session /private/path/session.txt \
  --name Al \
  --scopes preferences:read,routes:read,rides:score \
  --days 90 \
  --out /private/path/al-ride-on-key.json

bun scripts/agent-keys.ts list --session /private/path/session.txt
bun scripts/agent-keys.ts revoke KEY_ID --session /private/path/session.txt
```

Replace the example paths and key ID. The output must not already exist; it is
created with mode `600`. The command prints only the ID, expiry and output path.
Supply the saved key through the agent's supported secret-storage mechanism.
If creation times out, list keys before retrying because the first request may
have succeeded. `--local` targets the local Worker for development; it does not
create production credentials.

## Call the agent endpoints

Every operation is **POST**, with `Content-Type: application/json` and
`Authorization: Bearer <account-api-key>`. Send `{}` for an empty input. Responses
are the MCP tool's `structuredContent` directly, without a JSON-RPC envelope.
Cookies, app sessions, query-string keys and MCP OAuth tokens are not accepted.

| Endpoint | Input | Required scopes |
| --- | --- | --- |
| `/agent/v1/get_preferences` | `{}` | `preferences:read` |
| `/agent/v1/list_routes` | Optional `limit` (1–100, default 25), `cursor` | `routes:read` |
| `/agent/v1/add_route` | `file`, optional `name` | `routes:write` |
| `/agent/v1/score_routes` | `routeIds`, `date`, optional `window`, `includeReplay` | `rides:score`, `preferences:read`, `routes:read` |
| `/agent/v1/score_route_file` | `file`, `date`, optional `name`, `window`, `includeReplay` | `rides:score`, `preferences:read` |

Inputs are strict: unknown fields, including owner IDs or preference overrides,
are rejected. Preferences are loaded afresh for every score. A file is either
`{"format":"gpx","content":"complete GPX XML"}` or
`{"format":"fit","content":"standard base64 of actual FIT bytes"}`.
URLs and local paths cannot replace file content. Files are limited to 5 MB and
50,000 points; the outer JSON limit is 10 MB for file operations and 64 KB for
other operations. FIT accepts one GPS course or activity, validates integrity,
and retains route geometry rather than heart rate or power data.

`score_routes` accepts 1–12 unique saved route IDs belonging to this account.
`date` is `YYYY-MM-DD`, from today through 14 days ahead in the saved time zone;
forecast coverage can be shorter. Omit `window` to use the saved planning
window, or provide `"daylight"` or `{"start":"09:00","end":"14:00"}`.
The window must fit the entire ride. `includeReplay` defaults to `false`.

For example, this local Python snippet reads a previously provisioned key file
and makes an authenticated request without putting the secret in arguments:

```python
import json
from pathlib import Path
from urllib.request import Request, urlopen

key = json.loads(Path("/private/path/al-ride-on-key.json").read_text())["key"]

def ride_on(operation, payload):
    request = Request(
        "https://api.ride-on.cc/agent/v1/" + operation,
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        return json.load(response)

preferences = ride_on("get_preferences", {})
routes = ride_on("list_routes", {"limit": 25})
# Use an actual upcoming date in the rider's saved time zone:
# assessment = ride_on("score_route_file", {
#     "file": {"format": "gpx", "content": Path("candidate.gpx").read_text()},
#     "date": "YYYY-MM-DD",
#     "includeReplay": True,
# })
```

Scoring is transient: it does not save routes, select rides, schedule monitoring,
write ride history or update app score baselines. `add_route` is the only library
mutation. Identical file bytes and name are deduplicated across HTTP and MCP;
the existing `mcp` source identifier is retained for compatibility.

Scores include explanations, minimum-condition failures, coverage and forecast
provenance/freshness. Preserve the provider attribution and limitations. The best
evaluated route is not a global optimum or a guarantee of conditions or safety.
With `includeReplay: true`, save the returned object privately and replay it from
the matching source revision using `bun scripts/replay-mcp.ts assessment.json`.
The checksum detects modified evidence; it is not a signed forecast attestation.

## Errors and limits

Errors use `{"error":{"code":"…","message":"…"}}` and normal HTTP statuses:
`400` invalid input, `401 INVALID_API_KEY` invalid/expired/revoked key,
`403 INSUFFICIENT_SCOPE`, `404` missing profile/route/operation,
`413` oversized body, `415` wrong media type and `422` invalid file.
Authentication and permissions are checked before parsing the body.

Each key permits **60 requests per calendar minute**, admitted atomically in D1.
`429 RATE_LIMITED` includes `Retry-After`; wait before retrying. This is a request
limit, not a production throughput guarantee. Expiry and revocation are checked
on every call, without caching authentication decisions. Account deletion removes
its keys. Last-use metadata records authenticated admitted requests, including
ones subsequently rejected for scope or input errors.

MCP at `/mcp` continues to require OAuth. Product APIs such as `/users/me` and
`/routes` continue to require app sessions. API keys grant access only to the
five agent endpoints, not account management or other app features.

An API key supplies authentication; the agent still needs supported secure
credential storage and permission to make HTTPS requests. A local script does
not by itself install a persistent hosted Dot connection.

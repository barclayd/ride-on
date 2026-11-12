# Ride On MCP

Connect an agent to **https://api.ride-on.cc/mcp**. Each person signs into their
own Ride On account with Apple or Google and approves access in the browser.
Finish creating your rider profile in Ride On first. App sessions and API keys
cannot authenticate the MCP; the agent receives its own OAuth credentials.

For internal integrations that use ordinary HTTPS and an account API key,
the same five operations are available through the [agent HTTP API](agent-api.md).
Both transports share their schemas and implementation.

## Codex

```sh
codex mcp add ride-on --url https://api.ride-on.cc/mcp
codex mcp login ride-on --scopes preferences:read,routes:read,routes:write,rides:score,offline_access
```

Complete the browser sign-in and review the permissions. The URL can also be
configured in `~/.codex/config.toml`:

```toml
[mcp_servers.ride-on]
url = "https://api.ride-on.cc/mcp"
```

Use `codex mcp login ride-on` after adding it through configuration. Do not put
session tokens in the configuration. See the [official Codex MCP commands](https://learn.chatgpt.com/docs/developer-commands#codex-mcp).

## Claude

In Claude's **Settings → Connectors**, add a custom remote connector named
**Ride On** with URL **https://api.ride-on.cc/mcp**, then connect and approve its
permissions. If Claude asks how to identify the OAuth client, choose **Register
automatically**: this server supports dynamic client registration, rather than
Client ID Metadata Documents. Organisation administrators may need to add the
connector before members connect their individual accounts. See
[Claude's custom connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

For Claude Code:

```sh
claude mcp add --transport http ride-on https://api.ride-on.cc/mcp
```

Open `/mcp` in Claude Code and authenticate the Ride On server. See
[Claude Code MCP setup](https://code.claude.com/docs/en/mcp).

The included [`ride-on-routes` skill](../.agents/skills/ride-on-routes/SKILL.md)
is discovered by Codex in this repository and linked into `.claude/skills` for
Claude Code. To use it elsewhere, copy its folder to your client's personal
skills directory. The MCP tools also work without installing the skill.

## Permissions and disconnection

| Scope | Access |
| --- | --- |
| `preferences:read` | Personal riding settings and minimum conditions |
| `routes:read` | Saved route library |
| `routes:write` | Add routes, with identical uploads deduplicated |
| `rides:score` | Run the shared route scoring engine |
| `offline_access` | Renew the connection with a rotating refresh token |

Scoring also requires `preferences:read`, because its explanations and evidence
include the settings used. Scoring saved routes additionally requires
`routes:read`. Untick `routes:write` on the consent screen for a read-only
connection. Saving is the only library mutation exposed; preferences cannot be
changed through MCP. No tool accepts a user or owner ID.

Visit **https://api.ride-on.cc/auth/agents** to disconnect an agent. Ride On
deletes that user's consent, access tokens and refresh tokens for that client;
subsequent calls fail immediately. Removing a local MCP entry alone is not the
same as revoking its server-side grant. Access tokens last an hour; refresh
tokens rotate and have a rolling 30-day expiry. Without `offline_access`, sign
in again when the access token expires.

## Tools and route files

| Tool | Input | Result |
| --- | --- | --- |
| `get_preferences` | `{}` | Saved settings, profile version and preference levels |
| `list_routes` | Optional `limit` (1–100) and `cursor` | Route summaries and `nextCursor` |
| `add_route` | `file`, optional `name` | Saved route ID and `created`/`unchanged` |
| `score_routes` | 1–12 unique `routeIds`, `date`, optional `window`, `includeReplay` | Ranked saved routes and unassessable routes |
| `score_route_file` | `file`, `date`, optional `name`, `window`, `includeReplay` | An assessment without saving the file |

`date` is `YYYY-MM-DD` in the rider's saved time zone, from today through the
next 14 days. The actual provider horizon may be shorter. `window` is
`"daylight"` or `{ "start": "09:00", "end": "14:00" }`, a window containing the
**whole ride**, not just departure. It defaults to the saved planning window.
Daylight, speed, departure interval and all scoring preferences come from Ride
On. Compare candidates using the same date/window and current preference version.

GPX uses `{ "format": "gpx", "content": "<gpx ...>...</gpx>" }`.
FIT uses `{ "format": "fit", "content": "<standard base64 of raw bytes>" }`.
For example, `base64 < candidate.fit | tr -d '\n'` produces the FIT content.
The caller reads or downloads the file using its own file tools and passes the
content to MCP. URLs, local filesystem paths and attachment identifiers are not
file contents; the hosted server cannot open them. Never invent coordinates or
base64 to stand in for an unavailable file.

Files are limited to 5 MB and 50,000 route points; MCP request bodies are limited
to 10 MB. FIT accepts one course or activity, checks its header and CRC, and
uses position and elevation records. Heart rate, power and activity timestamps
are not retained. Indoor activities with no GPS route, multiple activities,
disconnected geometry and unsupported files fail with an actionable tool error.
GPX XML entities/DTDs are rejected. FIT uses the same geometry, ascent and
weather-location normalisation as GPX. Missing elevations remain missing.

## Evidence and independent replay

Successful tools return JSON in both `structuredContent` and a text block.
Assessments include 0–100 scores, component losses, benefits/drawbacks, minimum
condition checks, feasible departure coverage, unknowns, route file hashes,
profile version/settings, algorithm version, deployed source revision and forecast provenance/freshness.
The recommendation is the best evaluated option, not a proof of a global
optimum or a guarantee of future weather. Unranked routes must not be presented
as suitable. Preserve provider attribution when presenting weather evidence.

Set `includeReplay: true` to include normalised route and forecast data and the
per-departure recent-ride overlap evidence used by the deterministic engine.
Save the tool's `structuredContent` as JSON. From `api/` on the matching source
revision, run:

```sh
bun scripts/replay-mcp.ts /path/to/assessment.json
```

This makes no network requests. It checks the evidence checksum and algorithm
version, then recomputes each regional comparison. For mixed-region input, the
original response's rankings combine those comparisons. Recent-ride overlap is
an explicit scoring input; replay does not disclose or recompute the rider's
private historical tracks. The SHA-256 checksum detects accidental changes;
it is not a digital signature or independent verification of the weather model.
Keep exported evidence private because it includes personal settings and routes.
Scoring only writes shared forecast caches, not the route library, ride history,
tracked rides or app comparison baselines.

## Server and deployment

The existing Worker serves stateless Streamable HTTP using the official MCP
SDK, supporting the 2025 protocol and `2026-07-28`. Better Auth provides OAuth
2.1 authorisation codes with S256 PKCE, exact registered redirects (with native
loopback port handling), signed consent queries, scoped resource-bound opaque
tokens, refresh rotation and revocation. Tokens are hashed in D1; their active
state, resource audience, user identity and current consent are checked on every
request. DPoP-bound tokens require valid proofs with database-backed replay
protection. Machine-to-machine grants are disabled.

OAuth discovery is public at `/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server/api/auth`. Dynamic registration is
rate limited. It does not grant access until the user signs in and consents.
MCP requests with an Origin must match the configured Ride On trusted origins.
Tool names, route names and file metadata are data, not agent instructions.

Migration `0022_agent_oauth.sql` adds the provider tables without modifying
existing rider profiles or ownership. No new production secrets are needed.
The existing main-branch workflow checks, migrates and deploys the Worker.
`bun run check` covers OAuth, ownership, scope enforcement, refresh/revocation,
SDK interoperability, file parsing and serialised score replay using synthetic
weather; `bun run build:check` checks the Worker bundle. Real client sign-in
still requires the account holder to finish Apple/Google authentication.

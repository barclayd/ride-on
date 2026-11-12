import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// Internal account tooling. Credentials are read from private files, never argv.
const main = async () => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      name: { type: 'string' },
      scopes: { type: 'string' },
      days: { type: 'string', default: '90' },
      out: { type: 'string' },
      local: { type: 'boolean', default: false },
      'local-port': { type: 'string', default: '8787' },
      help: { type: 'boolean', default: false },
    },
  });
  const [command, id] = positionals;
  if (values.help) {
    console.log(`Usage:
  bun scripts/agent-keys.ts create --session /private/session.txt --name Al --scopes preferences:read,routes:read,rides:score --out /private/al.json
  bun scripts/agent-keys.ts list --session /private/session.txt
  bun scripts/agent-keys.ts revoke <key-id> --session /private/session.txt

--days 90 sets expiry (1–365 days). --local targets http://127.0.0.1:8787.
Use --local-port to select a different local development port.
The session file must contain an existing account session token and have mode 600.
Creation requires a sign-in within the last 10 minutes. The output file is created
with mode 600 and must not already exist. No secrets are printed.`);
    return;
  }
  if (
    !values.session ||
    !['create', 'list', 'revoke'].includes(command ?? '') ||
    positionals.length !== (command === 'revoke' ? 2 : 1)
  )
    throw new Error('Supply create/list/revoke and --session. See --help.');
  if (command === 'create' && (!values.name || !values.scopes || !values.out))
    throw new Error('Creation requires --name, --scopes and --out.');
  if (command === 'revoke' && !/^[a-f0-9-]{36}$/i.test(id ?? ''))
    throw new Error('Supply the key ID to revoke.');
  const sessionFile = await open(
    values.session,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let token: string;
  try {
    const stat = await sessionFile.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096)
      throw new Error(
        'Use a private session file (chmod 600), at most 4096 bytes.',
      );
    token = (await sessionFile.readFile('utf8')).trim();
    if (!token || /\s/.test(token))
      throw new Error('The session file must contain only the session token.');
  } finally {
    await sessionFile.close();
  }
  const port = Number(values['local-port']);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Use a valid local port.');
  const base = values.local
    ? `http://127.0.0.1:${port}`
    : 'https://api.ride-on.cc';
  const request = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: { code?: string };
      };
      // Report only the machine code; never echo an arbitrary response body.
      const code = /^[A-Z_]+$/.test(result.error?.code ?? '')
        ? result.error?.code
        : 'REQUEST_FAILED';
      throw new Error(
        `HTTP ${response.status}: ${code}. See docs/agent-api.md.`,
      );
    }
    return response;
  };
  if (command === 'create' && values.out) {
    // Check destination permissions/exclusivity before minting any credential.
    const output = await open(values.out, 'wx', 0o600);
    let createdId: string | undefined;
    try {
      const response = await request('/auth/api-keys', 'POST', {
        name: values.name,
        scopes: values.scopes?.split(','),
        expiresInDays: Number(values.days),
      });
      const created = (await response.json()) as {
        id: string;
        key: string;
        expiresAt: string;
      };
      createdId = created.id;
      await output.writeFile(`${JSON.stringify(created, null, 2)}\n`);
      await output.sync();
      console.log(
        `Created key ${created.id}; expires ${created.expiresAt}. Saved privately to ${values.out}.`,
      );
    } catch (error) {
      if (createdId) {
        try {
          await request(`/auth/api-keys/${createdId}`, 'DELETE');
        } catch {
          console.error(
            `Could not revoke unsaved key ${createdId}; revoke it with the account API.`,
          );
        }
      }
      await unlink(values.out);
      throw error;
    } finally {
      await output.close();
    }
  } else if (command === 'list') {
    let cursor: string | null = null;
    do {
      const response = await request(
        `/auth/api-keys?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
        'GET',
      );
      const result = (await response.json()) as {
        keys: unknown[];
        nextCursor: string | null;
      };
      console.log(JSON.stringify(result.keys, null, 2));
      cursor = result.nextCursor;
    } while (cursor);
  } else {
    await request(`/auth/api-keys/${id}`, 'DELETE');
    console.log(`Revoked key ${id}.`);
  }
};
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'API key command failed.',
  );
  process.exitCode = 1;
});

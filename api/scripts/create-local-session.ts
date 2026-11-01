/** Seed a 24-hour session in local D1 only; never connects to production. */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { authConfig } from '../src/identity/config.ts';

const [requestedOwner = 'local-rider', ...extra] = Bun.argv.slice(2);
if (extra.length || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(requestedOwner))
  throw new Error('Usage: bun run dev:session [local-owner-id]');
const root = fileURLToPath(new URL('../', import.meta.url).href);
const path = (name: string) => `${root}${name}`;
await mkdir(path('.wrangler'), { recursive: true });
const original = await readFile(path('.dev.vars'), 'utf8');
const values = parseEnv(original);
const config = values.AUTH_CONFIG_JSON
  ? authConfig({ AUTH_CONFIG_JSON: values.AUTH_CONFIG_JSON })
  : authConfig({
      AUTH_CONFIG_JSON: JSON.stringify({
        secret: randomBytes(48).toString('base64url'),
        baseUrl: 'https://localhost:8787',
      }),
    });
if (new URL(config.baseUrl).hostname !== 'localhost')
  throw new Error(
    'Local session setup requires a separate localhost auth configuration.',
  );
const token = randomBytes(32).toString('base64url');
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + 86400000).toISOString();
const userId = `local_${requestedOwner}`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sql = [
  `INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (${[userId, requestedOwner, `${userId}@example.test`].map(literal).join(', ')}, 1, ${literal(now)}, ${literal(now)}) ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO auth_user_owners (auth_user_id, owner_id) VALUES (${literal(userId)}, ${literal(requestedOwner)}) ON CONFLICT(auth_user_id) DO NOTHING;`,
  `INSERT INTO auth_session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (${[randomUUID(), userId, token, expiresAt, now, now].map(literal).join(', ')});`,
].join('\n');
const sqlPath = path(`.wrangler/local-session-${randomUUID()}.sql`);
await writeFile(sqlPath, sql, { mode: 0o600, flag: 'wx' });
try {
  // These arguments are fixed: no remote flag, environment or database override.
  const command = Bun.spawn(
    [
      'bunx',
      'wrangler',
      'd1',
      'execute',
      'ROUTES_DB',
      '--local',
      '--file',
      sqlPath,
    ],
    {
      cwd: root,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [status] = await Promise.all([
    command.exited,
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
  ]);
  if (status !== 0)
    throw new Error('Could not seed local D1. Apply local migrations first.');
} finally {
  await unlink(sqlPath);
}
const atomicPrivateWrite = async (destination: string, content: string) => {
  const temporary = path(`.wrangler/private-${randomUUID()}`);
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
};
// Preserve weather credentials; retire the unused private-key configuration.
const kept = original
  .split(/\r?\n/)
  .filter((line) => !/^(?:AUTH_CONFIG_JSON|API_KEYS_JSON)\s*=/.test(line));
const encodedConfig = JSON.stringify(config).replaceAll("'", '\\u0027');
await atomicPrivateWrite(
  path('.dev.vars'),
  `${kept.join('\n').trimEnd()}\nAUTH_CONFIG_JSON='${encodedConfig}'\n`,
);
await atomicPrivateWrite(
  path('.local-session.json'),
  `${JSON.stringify({ token, expiresAt, ownerId: requestedOwner }, null, 2)}\n`,
);
console.log(
  `Local session saved to .local-session.json; expires ${expiresAt}. Restart the local Worker if it is running.`,
);

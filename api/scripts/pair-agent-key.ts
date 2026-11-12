import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { createKeySchema } from '../src/identity/api-keys.ts';

const pendingSchema = z.strictObject({
  base: z.string(),
  key: z.string().regex(/^ro_agent_[a-f0-9]{64}$/),
  input: createKeySchema,
});
const readPrivate = async (path: string) => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16_384)
      throw new Error(
        'Setup files must be private (mode 600), regular files, at most 16 KB.',
      );
    try {
      return JSON.parse(await file.readFile('utf8')) as unknown;
    } catch {
      throw new Error(
        'The private setup file is incomplete. No credential was printed.',
      );
    }
  } finally {
    await file.close();
  }
};
const exists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
const savePrivate = async (path: string, value: unknown) => {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } catch (error) {
    await unlink(path);
    throw error;
  } finally {
    await file.close();
  }
};

// Restart with the same --out to resume the same request, never a second key.
export const pairAgentKey = async (options: {
  base: string;
  out: string;
  name?: string;
  scopes?: string;
  days?: string;
  startOnly?: boolean;
}) => {
  const pendingPath = `${options.out}.pending`;
  if (await exists(options.out))
    throw new Error(
      'The output file already exists. Use the existing credential; it will not be overwritten.',
    );
  let pending: z.infer<typeof pendingSchema>;
  if (await exists(pendingPath)) {
    const parsed = pendingSchema.safeParse(await readPrivate(pendingPath));
    if (!parsed.success)
      throw new Error('Invalid private setup file. No request was sent.');
    pending = parsed.data;
    if (pending.base !== options.base)
      throw new Error('Resume against the original API origin.');
    if (
      (options.name && options.name !== pending.input.name) ||
      (options.scopes && options.scopes !== pending.input.scopes.join(',')) ||
      (options.days !== undefined &&
        Number(options.days) !== pending.input.expiresInDays)
    )
      throw new Error(
        'Resume with the original name, permissions and lifetime, or omit them.',
      );
  } else {
    const parsed = createKeySchema.safeParse({
      name: options.name,
      scopes: options.scopes?.split(','),
      expiresInDays: Number(options.days ?? 90),
    });
    if (!parsed.success)
      throw new Error('Supply a valid --name, --scopes and --days (1–365).');
    pending = {
      base: options.base,
      key: `ro_agent_${randomBytes(32).toString('hex')}`,
      input: parsed.data,
    };
    // Persist before contacting the server, so an interrupted command cannot
    // lose a key that was approved from the phone.
    await savePrivate(pendingPath, pending);
  }
  const request = async (path: string, body: unknown) => {
    let response: Response;
    try {
      response = await fetch(`${options.base}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pending.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(
        'Connection interrupted. Run pair again with the same --out to resume safely.',
      );
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: { code?: string };
      };
      const code = /^[A-Z_]+$/.test(data.error?.code ?? '')
        ? data.error?.code
        : 'REQUEST_FAILED';
      throw new Error(
        `HTTP ${response.status}: ${code}. Run pair again with the same --out to resume.`,
      );
    }
    return response.json();
  };
  const startedSchema = z.object({
    verificationUri: z.url(),
    userCode: z.string().regex(/^[A-F0-9]{4}-[A-F0-9]{4}$/),
    expiresAt: z.iso.datetime(),
    status: z.enum(['pending', 'approved', 'denied', 'expired']),
  });
  const startedResult = startedSchema.safeParse(
    await request('/auth/api-key-requests', pending.input),
  );
  if (!startedResult.success)
    throw new Error(
      'Unexpected setup response. The private setup file was retained.',
    );
  const started = startedResult.data;
  const url = new URL(started.verificationUri);
  if (
    url.origin !== options.base ||
    url.pathname !== '/auth/agents/key' ||
    !/^[a-f0-9]{64}$/.test(url.searchParams.get('request') ?? '')
  )
    throw new Error('The server returned an unexpected approval URL.');
  if (started.status === 'pending') {
    console.log(
      `Open on your phone: ${url.href}\nCheck setup code: ${started.userCode}\nApprove before ${started.expiresAt}. No secret is included in this link.`,
    );
    if (options.startOnly) return;
  }
  const resultSchema = z.object({
    status: z.enum(['pending', 'approved', 'denied', 'expired']),
    credential: z
      .object({
        id: z.uuid(),
        name: z.string(),
        prefix: z.string(),
        scopes: z.array(z.string()),
        createdAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        revokedAt: z.null(),
        lastUsedAt: z.string().nullable(),
      })
      .optional(),
    account: z.object({ email: z.email() }).optional(),
  });
  while (true) {
    const parsed = resultSchema.safeParse(
      await request('/auth/api-key-requests/status', {}),
    );
    if (!parsed.success)
      throw new Error(
        'Unexpected setup status. The private setup file was retained.',
      );
    const result = parsed.data;
    if (result.status === 'approved') {
      const credential = result.credential;
      if (
        !credential ||
        !result.account ||
        credential.prefix !== pending.key.slice(0, 17) ||
        credential.name !== pending.input.name ||
        JSON.stringify(credential.scopes) !==
          JSON.stringify(pending.input.scopes)
      )
        throw new Error('The approved credential does not match this setup.');
      await savePrivate(options.out, {
        key: pending.key,
        ...credential,
        account: result.account,
      });
      await unlink(pendingPath);
      console.log(
        `Created key ${credential.id}; expires ${credential.expiresAt}. Saved privately to ${options.out}.`,
      );
      return;
    }
    if (result.status === 'denied' || result.status === 'expired') {
      await unlink(pendingPath);
      throw new Error(
        `Setup ${result.status}; no key was activated. Run pair again to start a new request.`,
      );
    }
    if (Date.now() > Date.parse(started.expiresAt) + 30_000)
      throw new Error(
        'Setup timed out. Run pair again with the same --out to check its final status.',
      );
    await Bun.sleep(5000);
  }
};

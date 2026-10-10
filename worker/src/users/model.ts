import { z } from 'zod';
import {
  settingsPatchSchema,
  settingsSchema,
} from '../recommendations/input.ts';

const displayName = z.string().trim().min(1).max(100);
export const createUserSchema = z.strictObject({
  displayName,
  settings: settingsPatchSchema.optional(),
});
export const updateUserSchema = z
  .strictObject({
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    displayName: displayName.optional(),
    settings: settingsPatchSchema.optional(),
  })
  .refine(
    (input) => input.displayName !== undefined || input.settings !== undefined,
    {
      message: 'Supply a display name or settings to update.',
    },
  );
export const userSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(100),
  version: z.number().int().positive(),
  displayName,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: settingsSchema,
});
export type User = z.infer<typeof userSchema>;
export type UserStore = Readonly<{
  get: (ownerId: string) => Promise<User | null>;
  create: (user: User) => Promise<boolean>;
  update: (user: User, expectedVersion: number) => Promise<boolean>;
}>;
export const createD1UserStore = (db: D1Database): UserStore => ({
  get: async (ownerId) => {
    const row = await db
      .prepare('SELECT user_json FROM users WHERE id = ?')
      .bind(ownerId)
      .first<{ user_json: string }>();
    return row ? userSchema.parse(JSON.parse(row.user_json)) : null;
  },
  create: async (user) => {
    const result = await db
      .prepare(
        'INSERT INTO users (id, version, user_json) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(user.id, user.version, JSON.stringify(user))
      .run();
    return result.meta.changes === 1;
  },
  update: async (user, expectedVersion) => {
    // Compare and write atomically, including when two devices update at once.
    const result = await db
      .prepare(
        'UPDATE users SET version = ?, user_json = ? WHERE id = ? AND version = ?',
      )
      .bind(user.version, JSON.stringify(user), user.id, expectedVersion)
      .run();
    return result.meta.changes === 1;
  },
});

import { z } from '@hono/zod-openapi';
import {
  defaultSettings,
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
  settings: settingsSchema.extend({
    timeZone: settingsSchema.shape.timeZone.default(defaultSettings.timeZone),
  }),
});
export type User = z.infer<typeof userSchema>;

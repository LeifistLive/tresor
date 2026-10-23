import { z } from 'zod';
import { LANGUAGES, PASSWORD_MIN, ROLES, THEMES } from './auth.js';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'username_format');

export const passwordSchema = z.string().min(PASSWORD_MIN).max(256);

export const displayNameSchema = z.string().trim().min(1).max(64);

export const preferencesSchema = z.object({
  displayName: displayNameSchema.optional(),
  language: z.enum(LANGUAGES).optional(),
  theme: z.enum(THEMES).optional(),
  autoLockMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  role: z.enum(ROLES).default('user'),
  password: passwordSchema,
});

export const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  disabled: z.boolean().optional(),
  displayName: displayNameSchema.optional(),
});

export const resetUserSchema = z.object({
  password: passwordSchema,
});

export const totpCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

import { z } from 'zod';
import { NOTIFY_PROVIDERS, VAULT_ROLES } from './features.js';
import { LIMITS } from './notes.js';

// --- Shared vaults --------------------------------------------------------------------------------

export const vaultNameSchema = z.string().trim().min(1).max(LIMITS.vaultName);
export const vaultMemberRoleSchema = z.object({ role: z.enum(VAULT_ROLES) });

// --- Notifications --------------------------------------------------------------------------------

export const notificationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(NOTIFY_PROVIDERS).default('ntfy'),
  /** Server base URL, e.g. https://ntfy.sh or https://gotify.example.home. For webhooks the full URL. */
  url: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .or(z.literal(''))
    .default(''),
  /** ntfy topic. */
  topic: z
    .string()
    .trim()
    .max(120)
    .regex(/^[\w-]*$/)
    .default(''),
  /** ntfy access token or Gotify application token. Empty string keeps the stored token. */
  token: z.string().max(300).default(''),
  events: z
    .object({
      newLogin: z.boolean().default(true),
      failedLogin: z.boolean().default(true),
      emergency: z.boolean().default(true),
      reminders: z.boolean().default(true),
      adminAlerts: z.boolean().default(false),
    })
    .default({ newLogin: true, failedLogin: true, emergency: true, reminders: true, adminAlerts: false }),
});
export type NotificationConfigInput = z.input<typeof notificationConfigSchema>;

// --- Passkeys -------------------------------------------------------------------------------------

export const passkeyNameSchema = z.object({ name: z.string().trim().min(1).max(64) });

/** Minimal shape of a serialized WebAuthn credential sent by the browser (validated in depth server-side). */
export const webauthnResponseSchema = z.object({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.record(z.string(), z.unknown()),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.string().optional(),
});

export const passkeyRegisterVerifySchema = z.object({
  /** Password confirmation (auth key) – a passkey is a lasting way into the account. */
  authKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  challengeId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(64),
  response: webauthnResponseSchema,
  /** The account key wrapped with the passkey PRF output (computed in the browser) – enables unlocking. */
  dekWrapped: z
    .string()
    .min(40)
    .max(4_096)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export const passkeyLoginVerifySchema = z.object({
  challengeId: z.string().min(1).max(100),
  response: webauthnResponseSchema,
});

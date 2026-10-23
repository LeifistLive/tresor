/** Constants shared by API and UI (kept free of zod so the web bundle stays small). */

export const VAULT_ROLES = ['owner', 'editor', 'viewer'] as const;
export type VaultRole = (typeof VAULT_ROLES)[number];

export const EMERGENCY_WAIT_DAYS = [1, 2, 3, 7, 14, 30] as const;

export const NOTIFY_PROVIDERS = ['ntfy', 'gotify', 'webhook'] as const;
export type NotifyProvider = (typeof NOTIFY_PROVIDERS)[number];

export const NOTIFY_EVENTS = ['newLogin', 'failedLogin', 'emergency', 'reminders', 'adminAlerts'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** Days before `expiresAt` from which an entry counts as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 30;

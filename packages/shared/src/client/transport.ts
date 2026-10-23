import type { ErrorCode } from '../api.js';

/** Error raised for failed API calls and for client-side problems (wrong recovery key, locked vault …). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface UploadForm {
  /** Text fields, sent before the file. */
  fields: Record<string, string>;
  file: { name: string; data: Uint8Array };
}

/**
 * How the client talks to the server: `fetch` in the browser, `app.inject` in tests. Implementations
 * throw `ApiError` for non-2xx responses. Paths are relative to `/api`.
 */
export interface Transport {
  json<T>(method: Method, path: string, body?: unknown): Promise<T>;
  bytes(path: string): Promise<Uint8Array>;
  upload<T>(method: 'POST', path: string, form: UploadForm): Promise<T>;
}

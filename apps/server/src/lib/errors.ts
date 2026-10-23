import type { ErrorCode } from '@tresor/shared';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCode = 'BAD_REQUEST', message?: string) =>
  new AppError(400, code, message);
export const unauthorized = (code: ErrorCode = 'UNAUTHORIZED', message?: string) =>
  new AppError(401, code, message);
export const forbidden = (code: ErrorCode = 'FORBIDDEN', message?: string) =>
  new AppError(403, code, message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: ErrorCode = 'CONFLICT', message?: string) => new AppError(409, code, message);

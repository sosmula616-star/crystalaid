export const ERROR_CODES = [
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_STAFF',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'SELF_ACTION',
  'GUILD_REQUIRED',
  'INVALID_INSTANCE',
  'DISCORD_UNAVAILABLE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

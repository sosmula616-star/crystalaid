export const ERROR_CODES = [
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_STAFF',
  'NOT_FOUND',
  'CONFLICT',
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
  /** Optional machine-readable detail (for example `support_role_missing`); clients map it to their own text. */
  readonly reason?: string;

  constructor(code: ErrorCode, message: string, status: number, reason?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (reason !== undefined) this.reason = reason;
  }
}

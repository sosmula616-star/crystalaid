import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ErrorCode } from '@crystalaid/contracts';

export interface ErrorBody {
  error: { code: ErrorCode; message: string; requestId: string; reason?: string };
}

const CLIENT_ERRORS: Record<number, [ErrorCode, string]> = {
  400: ['VALIDATION_ERROR', 'Invalid request'],
  404: ['NOT_FOUND', 'Not found'],
  413: ['VALIDATION_ERROR', 'Request body too large'],
  415: ['VALIDATION_ERROR', 'Unsupported content type'],
  429: ['RATE_LIMITED', 'Too many requests'],
};

/** One error shape for every failure. Unexpected errors are logged, never echoed to the client. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError | ZodError, request, reply) => {
    let status: number;
    let code: ErrorCode;
    let message: string;
    let reason: string | undefined;

    if (err instanceof AppError) {
      ({ status, code, message, reason } = err);
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = `Invalid request: ${[...new Set(err.issues.map((i) => i.path.join('.') || 'body'))].join(', ')}`;
    } else if (typeof err.statusCode === 'number' && CLIENT_ERRORS[err.statusCode]) {
      status = err.statusCode;
      [code, message] = CLIENT_ERRORS[err.statusCode]!;
    } else {
      request.log.error({ err }, 'unhandled error');
      status = 500;
      code = 'INTERNAL';
      message = 'Internal server error';
    }
    const body: ErrorBody = { error: { code, message, requestId: request.id, ...(reason === undefined ? {} : { reason }) } };
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorBody = {
      error: { code: 'NOT_FOUND', message: 'Not found', requestId: request.id },
    };
    return reply.status(404).send(body);
  });
}

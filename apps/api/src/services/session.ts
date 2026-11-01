import { SignJWT, errors, jwtVerify } from 'jose';
import { AppError } from '@crystalaid/contracts';

export const SESSION_TTL_SECONDS = 15 * 60;

export interface SessionClaims {
  userId: string;
  discordUserId: string;
}

const key = (secret: string) => new TextEncoder().encode(secret);

/** HS256 JWT valid for 15 minutes. Level and permissions are never put into the token. */
export function signSession(claims: SessionClaims, secret: string): Promise<string> {
  return new SignJWT({ userId: claims.userId, discordUserId: claims.discordUserId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** An expired token is `TOKEN_EXPIRED` (the client may log in again); anything else is `UNAUTHORIZED`. */
export async function verifySession(token: string, secret: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      // A token that never expires must not be accepted.
      requiredClaims: ['exp', 'iat'],
    });
    if (typeof payload.userId !== 'string' || typeof payload.discordUserId !== 'string') {
      throw new AppError('UNAUTHORIZED', 'Invalid session', 401);
    }
    return { userId: payload.userId, discordUserId: payload.discordUserId };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof errors.JWTExpired) throw new AppError('TOKEN_EXPIRED', 'Session expired', 401);
    throw new AppError('UNAUTHORIZED', 'Invalid session', 401);
  }
}

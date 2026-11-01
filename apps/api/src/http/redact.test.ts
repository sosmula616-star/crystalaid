import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('hides tokens, credentials in urls and key=value secrets', () => {
    const out = redactSecrets(
      'fail Bearer abc123secret postgres://user:pw@host/db SERVICE_TOKEN=xyz987 ' +
        'MTIzNDU2Nzg5MDEyMzQ1Njc4.GabcdE.abcdefghijklmnopqrstuvwxyz1 ' +
        'a'.repeat(40),
    );
    expect(out).toBe('fail Bearer *** postgres://***@host/db SERVICE_TOKEN=*** *** ***');
  });
  it('keeps ordinary text', () => {
    expect(redactSecrets('Cannot read properties of undefined')).toBe('Cannot read properties of undefined');
  });
});

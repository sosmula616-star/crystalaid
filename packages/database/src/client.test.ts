import { describe, expect, it, vi } from 'vitest';
import { createDb } from './client.js';

describe('createDb', () => {
  it('survives an error event on the pool', async () => {
    const db = createDb('postgres://u:p@localhost:1/none');
    expect(() => db.$client.emit('error', new Error('idle connection dropped'))).not.toThrow();
    await db.$client.end();
  });

  it('passes pool errors to onError', async () => {
    const onError = vi.fn();
    const db = createDb('postgres://u:p@localhost:1/none', onError);
    const err = new Error('boom');
    db.$client.emit('error', err);
    expect(onError).toHaveBeenCalledWith(err);
    await db.$client.end();
  });
});

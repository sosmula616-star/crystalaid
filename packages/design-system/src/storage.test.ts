import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStored, writeStored } from './storage.js';

afterEach(() => vi.unstubAllGlobals());

describe('storage with a working localStorage', () => {
  it('round-trips values and returns null for missing keys', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    expect(readStored('theme')).toBeNull();
    writeStored('theme', 'amber');
    expect(readStored('theme')).toBe('amber');
  });
});

describe('storage when localStorage throws', () => {
  it('readStored returns null and writeStored does not throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    });
    expect(readStored('theme')).toBeNull();
    expect(() => writeStored('theme', 'amber')).not.toThrow();
  });

  it('survives the accessor itself throwing', () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError'); },
    });
    expect(readStored('theme')).toBeNull();
    expect(() => writeStored('theme', 'amber')).not.toThrow();
    // @ts-expect-error cleanup of the test-only accessor
    delete globalThis.localStorage;
  });
});

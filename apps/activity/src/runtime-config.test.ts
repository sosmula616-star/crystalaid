import { describe, expect, it } from 'vitest';
import { readClientId } from './runtime-config.js';

describe('readClientId', () => {
  it('prefers the id injected at runtime', () => {
    expect(readClientId('123', 'build')).toBe('123');
  });
  it('falls back to the build-time id', () => {
    expect(readClientId(undefined, 'build')).toBe('build');
    expect(readClientId('  ', 'build')).toBe('build');
  });
  it('is empty when neither is set', () => {
    expect(readClientId(undefined, undefined)).toBe('');
  });
});

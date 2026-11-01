import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeStartupError, loadRootEnvFile } from './startup.js';

describe('loadRootEnvFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crystalaid-env-'));
  afterEach(() => {
    delete process.env.CA_TEST_FROM_FILE;
    delete process.env.CA_TEST_SET_BY_ENV;
  });

  it('reads the file, lets real environment variables win, and does nothing without a file', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'CA_TEST_FROM_FILE=from-file\nCA_TEST_SET_BY_ENV=from-file\n');
    process.env.CA_TEST_SET_BY_ENV = 'from-env';
    expect(loadRootEnvFile(file)).toBe(true);
    expect(process.env.CA_TEST_FROM_FILE).toBe('from-file');
    expect(process.env.CA_TEST_SET_BY_ENV).toBe('from-env');

    expect(loadRootEnvFile(join(dir, 'missing.env'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('describeStartupError', () => {
  it('prints the cause chain and the members of an AggregateError', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const aggregate = new AggregateError([refused, new Error('connect ECONNREFUSED ::1:5432')], '');
    const err = new Error('startup failed', { cause: aggregate });
    const text = describeStartupError(err).join('\n');
    expect(text).toContain('Error: startup failed');
    expect(text).toContain('caused by: AggregateError');
    expect(text).toContain('connect ECONNREFUSED 127.0.0.1:5432');
    expect(text).toContain('connect ECONNREFUSED ::1:5432');
  });

  it('shows the code when the message is empty', () => {
    const err = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    expect(describeStartupError(err)).toEqual(['Error: ECONNREFUSED']);
  });

  it('never prints a connection string', () => {
    const err = new Error('bad url postgres://crystal:hunter2@db.internal:5432/app', {
      cause: new Error('redis://:s3cret@cache:6379 refused'),
    });
    const text = describeStartupError(err).join('\n');
    expect(text).not.toMatch(/hunter2|s3cret|crystal:/);
    expect(text).toContain('[url]');
  });

  it('survives a cause loop and a non-error value', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(describeStartupError(a)).toHaveLength(2);
    expect(describeStartupError('plain')).toEqual(['plain']);
  });
});

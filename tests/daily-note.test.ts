import { describe, expect, it } from 'vitest';
import { HumanError } from '../src/errors';
import { parentFolderOf, resolveDailyNotePath } from '../src/vault/daily-note';

/** Stands in for Moment. Only the tokens the tests exercise. */
const fmt = (template: string, date: Date): string =>
  template
    .replace(/YYYY/g, String(date.getUTCFullYear()))
    .replace(/MM/g, String(date.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/DD/g, String(date.getUTCDate()).padStart(2, '0'));

const day = new Date(Date.UTC(2026, 6, 8)); // 2026-07-08

describe('resolveDailyNotePath', () => {
  it('puts a note in the vault root when no folder is set', () => {
    expect(resolveDailyNotePath({ folder: '', filenameTemplate: 'YYYY-MM-DD' }, day, fmt)).toBe(
      '2026-07-08.md',
    );
  });

  it('joins folder and name', () => {
    expect(resolveDailyNotePath({ folder: 'Inbox/TG', filenameTemplate: 'YYYY-MM-DD' }, day, fmt)).toBe(
      'Inbox/TG/2026-07-08.md',
    );
  });

  it('allows a template that nests by month', () => {
    expect(resolveDailyNotePath({ folder: 'Daily', filenameTemplate: 'YYYY/MM/YYYY-MM-DD' }, day, fmt)).toBe(
      'Daily/2026/07/2026-07-08.md',
    );
  });

  it('normalises duplicate and stray slashes', () => {
    expect(resolveDailyNotePath({ folder: 'a//b', filenameTemplate: 'YYYY-MM-DD' }, day, fmt)).toBe(
      'a/b/2026-07-08.md',
    );
  });

  it('accepts a literal template with no tokens', () => {
    expect(resolveDailyNotePath({ folder: '', filenameTemplate: 'Telegram' }, day, fmt)).toBe('Telegram.md');
  });

  it('rejects a template that renders empty', () => {
    expect(() => resolveDailyNotePath({ folder: '', filenameTemplate: '   ' }, day, fmt)).toThrow(HumanError);
  });

  it('rejects path traversal', () => {
    expect(() => resolveDailyNotePath({ folder: '', filenameTemplate: '../secrets' }, day, fmt)).toThrow(
      HumanError,
    );
    expect(() => resolveDailyNotePath({ folder: 'a', filenameTemplate: 'x/../../y' }, day, fmt)).toThrow(
      HumanError,
    );
  });

  it('rejects characters that break a file name on some platform', () => {
    for (const bad of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'a#b', 'a[b]', 'a^b', 'a\\b']) {
      expect(() => resolveDailyNotePath({ folder: '', filenameTemplate: bad }, day, fmt)).toThrow(HumanError);
    }
  });

  it('rejects an empty path segment', () => {
    expect(() => resolveDailyNotePath({ folder: '', filenameTemplate: 'a//b' }, day, fmt)).toThrow(HumanError);
  });

  it('reports the offending template in the error, not a stack trace', () => {
    try {
      resolveDailyNotePath({ folder: '', filenameTemplate: 'Q3?' }, day, fmt);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HumanError);
      expect((e as HumanError).params?.template).toBe('Q3?');
    }
  });

  it('puts messages from different days in different notes', () => {
    const s = { folder: '', filenameTemplate: 'YYYY-MM-DD' };
    const a = resolveDailyNotePath(s, new Date(Date.UTC(2026, 6, 8, 23, 59)), fmt);
    const b = resolveDailyNotePath(s, new Date(Date.UTC(2026, 6, 9, 0, 1)), fmt);
    expect(a).not.toBe(b);
  });
});

describe('parentFolderOf', () => {
  it('returns the empty string for a root note', () => {
    expect(parentFolderOf('2026-07-08.md')).toBe('');
  });

  it('returns everything before the last slash', () => {
    expect(parentFolderOf('a/b/c.md')).toBe('a/b');
  });
});

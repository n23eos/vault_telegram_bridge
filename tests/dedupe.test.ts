import { describe, expect, it } from 'vitest';
import { extractMarkers, markerKey } from '../src/sync/dedupe';

/**
 * `dedupe.ts` no longer writes anything — records live in frontmatter. What it
 * still owes us is the promise that a note written by an older version is
 * recognised and never re-synced.
 */

describe('markerKey', () => {
  it('is the canonical chat:message identity', () => {
    expect(markerKey({ chatId: '777000', messageId: 42 })).toBe('777000:42');
    expect(markerKey({ chatId: '-1001234567890', messageId: 1 })).toBe('-1001234567890:1');
  });
});

describe('extractMarkers — legacy notes must not re-sync', () => {
  it('finds nothing in a note that never had markers', () => {
    expect(extractMarkers('# Hello\n\n**15:29** an idea\n').size).toBe(0);
  });

  it('reads the v1 inline Obsidian-comment format', () => {
    const note = ['- 09:12 one %%tg:777000:1%%', '- 09:13 two %%tg:777000:2%%'].join('\n');
    expect(extractMarkers(note)).toEqual(new Set(['777000:1', '777000:2']));
  });

  it('reads the HTML-comment format that was never shipped but was contemplated', () => {
    expect(extractMarkers('- b <!-- tg:1:2 -->\n- c <!--tg:1:3-->')).toEqual(new Set(['1:2', '1:3']));
  });

  it('reads negative chat ids', () => {
    expect(extractMarkers('x %%tg:-1001234567890:6%%')).toEqual(new Set(['-1001234567890:6']));
  });

  it('dedupes repeated markers', () => {
    expect(extractMarkers('%%tg:1:1%% %%tg:1:1%%').size).toBe(1);
  });

  it('is not confused by prose that merely mentions tg:', () => {
    expect(extractMarkers('see tg:1:1 for details').size).toBe(0);
  });

  it('does not match a malformed marker', () => {
    expect(extractMarkers('%%tg:abc:1%%').size).toBe(0);
    expect(extractMarkers('%%tg:1%%').size).toBe(0);
  });

  it('is stateless across calls despite the module-level global regex', () => {
    const note = '%%tg:5:5%%';
    expect(extractMarkers(note).size).toBe(1);
    expect(extractMarkers(note).size).toBe(1); // would be 0 on the 2nd call if lastIndex leaked
  });
});

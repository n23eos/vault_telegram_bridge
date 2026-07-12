import { describe, expect, it } from 'vitest';
import { readSyncedIds, splitFrontmatter, writeSyncedIds } from '../src/vault/frontmatter';

describe('readSyncedIds', () => {
  it('returns nothing for a note without frontmatter', () => {
    expect(readSyncedIds('# Hello\n').size).toBe(0);
    expect(readSyncedIds('').size).toBe(0);
  });

  it('returns nothing when the key is absent', () => {
    expect(readSyncedIds('---\ntags:\n  - x\n---\nbody\n').size).toBe(0);
  });

  it('reads a block list', () => {
    const c = '---\ntg_ids:\n  - "1:2"\n  - "1:3"\n---\n';
    expect(readSyncedIds(c)).toEqual(new Set(['1:2', '1:3']));
  });

  it('reads an unquoted block list, which a user may have hand-edited', () => {
    expect(readSyncedIds('---\ntg_ids:\n  - 1:2\n---\n')).toEqual(new Set(['1:2']));
  });

  it('reads a flow list, which Obsidian’s Properties editor writes', () => {
    expect(readSyncedIds('---\ntg_ids: ["1:2", "1:3"]\n---\n')).toEqual(new Set(['1:2', '1:3']));
    expect(readSyncedIds('---\ntg_ids: [1:2]\n---\n')).toEqual(new Set(['1:2']));
  });

  it('reads an empty flow list', () => {
    expect(readSyncedIds('---\ntg_ids: []\n---\n').size).toBe(0);
  });

  it('reads negative chat ids', () => {
    expect(readSyncedIds('---\ntg_ids:\n  - "-1001234:5"\n---\n')).toEqual(new Set(['-1001234:5']));
  });

  it('stops at the next top-level key', () => {
    const c = '---\ntg_ids:\n  - "1:2"\ntags:\n  - x\n---\n';
    expect(readSyncedIds(c)).toEqual(new Set(['1:2']));
  });

  it('ignores a --- that is not on the first line', () => {
    expect(readSyncedIds('text\n---\ntg_ids:\n  - "1:2"\n---\n').size).toBe(0);
  });

  it('ignores an unterminated --- (that is a horizontal rule, not frontmatter)', () => {
    expect(readSyncedIds('---\ntg_ids:\n  - "1:2"\n').size).toBe(0);
  });

  it('ignores a tg_ids that appears in the body', () => {
    expect(readSyncedIds('---\ntags: []\n---\n\ntg_ids:\n  - "1:2"\n').size).toBe(0);
  });
});

describe('writeSyncedIds', () => {
  it('creates frontmatter, tags the note, and records the ids', () => {
    expect(writeSyncedIds('## Telegram\n- a\n', ['1:2'])).toBe(
      '---\ntags:\n  - tg-bridge\ntg_ids:\n  - "1:2"\n---\n## Telegram\n- a\n',
    );
  });

  it('creates frontmatter for an empty note', () => {
    expect(writeSyncedIds('', ['1:2'])).toBe('---\ntags:\n  - tg-bridge\ntg_ids:\n  - "1:2"\n---\n');
  });

  it('does not insert a blank line between the frontmatter and the body', () => {
    expect(writeSyncedIds('# Day\n', ['1:2'])).toContain('---\n# Day\n');
  });

  it('quotes ids, so a colon is never read as a mapping', () => {
    expect(writeSyncedIds('', ['1:2'])).toContain('- "1:2"');
  });

  it('adds the key to existing frontmatter without touching other lines', () => {
    const before = '---\ntitle: My day\ntags:\n  - journal\n---\nbody\n';
    expect(writeSyncedIds(before, ['1:2'])).toBe(
      '---\ntitle: My day\ntags:\n  - journal\ntg_ids:\n  - "1:2"\n---\nbody\n',
    );
  });

  it('does not add the tg-bridge tag to a note that already had frontmatter', () => {
    // The user's own note; we add bookkeeping, not opinions.
    const out = writeSyncedIds('---\ntitle: x\n---\nbody\n', ['1:2']);
    expect(out).not.toContain('tg-bridge');
  });

  it('replaces an existing block list rather than appending a second key', () => {
    const before = '---\ntg_ids:\n  - "1:2"\n---\nbody\n';
    const out = writeSyncedIds(before, ['1:2', '1:3']);
    expect(out).toBe('---\ntg_ids:\n  - "1:2"\n  - "1:3"\n---\nbody\n');
    expect(out.match(/tg_ids:/g)).toHaveLength(1);
  });

  it('replaces a flow list', () => {
    const out = writeSyncedIds('---\ntg_ids: ["1:2"]\n---\nbody\n', ['1:2', '1:3']);
    expect(out).toBe('---\ntg_ids:\n  - "1:2"\n  - "1:3"\n---\nbody\n');
  });

  it('preserves keys that follow the one it replaces', () => {
    const before = '---\ntg_ids:\n  - "1:2"\ntitle: keep me\n---\nbody\n';
    const out = writeSyncedIds(before, ['1:9']);
    expect(out).toContain('title: keep me');
    expect(readSyncedIds(out)).toEqual(new Set(['1:9']));
  });

  it('handles an empty id list', () => {
    expect(writeSyncedIds('---\ntg_ids:\n  - "1:2"\n---\nbody\n', [])).toBe('---\ntg_ids:\n---\nbody\n');
  });

  it('leaves the body byte-for-byte intact, including its own ---', () => {
    const before = '---\ntitle: x\n---\nbefore\n\n---\n\nafter\n';
    const out = writeSyncedIds(before, ['1:2']);
    expect(out.endsWith('before\n\n---\n\nafter\n')).toBe(true);
  });

  it('round-trips: what it writes, it reads back', () => {
    const ids = ['1:2', '-100:3', '999999999:1'];
    expect(readSyncedIds(writeSyncedIds('body', ids))).toEqual(new Set(ids));
  });

  it('round-trips through repeated application without duplicating the key', () => {
    let c = 'body';
    for (const id of ['1:1', '1:2', '1:3']) {
      c = writeSyncedIds(c, [...readSyncedIds(c), id]);
    }
    expect(c.match(/tg_ids:/g)).toHaveLength(1);
    expect(readSyncedIds(c)).toEqual(new Set(['1:1', '1:2', '1:3']));
  });
});

describe('splitFrontmatter', () => {
  it('splits at the closing delimiter', () => {
    const { head, body } = splitFrontmatter('---\na: 1\n---\nbody\n');
    expect(head).toBe('---\na: 1\n---');
    expect(body).toBe('body\n');
  });

  it('returns the whole note as body when there is no frontmatter', () => {
    expect(splitFrontmatter('body\n')).toEqual({ head: '', body: 'body\n' });
  });
});

describe('writeSyncedIds — ensureTag (review fix: seeded templates)', () => {
  it('adds the tag to seed frontmatter that has no tags key', () => {
    const seeded = '---\naliases:\n  - today\n---\nbody\n';
    const out = writeSyncedIds(seeded, ['555:1'], true);
    expect(out).toContain('tags:');
    expect(out).toContain('- tg-bridge');
    expect(out).toContain('aliases:');
  });

  it('appends the tag to an existing block-style tags list', () => {
    const seeded = '---\ntags:\n  - daily\n---\nbody\n';
    const out = writeSyncedIds(seeded, ['555:1'], true);
    expect(out).toContain('- daily');
    expect(out).toContain('- tg-bridge');
  });

  it('appends the tag to a flow-style tags list', () => {
    const seeded = '---\ntags: [daily, journal]\n---\nbody\n';
    const out = writeSyncedIds(seeded, ['555:1'], true);
    expect(out).toContain('tags: [daily, journal, tg-bridge]');
  });

  it('converts a scalar tags value rather than clobbering it', () => {
    const seeded = '---\ntags: daily\n---\nbody\n';
    const out = writeSyncedIds(seeded, ['555:1'], true);
    expect(out).toContain('- daily');
    expect(out).toContain('- tg-bridge');
  });

  it('does not duplicate an already-present tag', () => {
    const seeded = '---\ntags:\n  - tg-bridge\n---\nbody\n';
    const out = writeSyncedIds(seeded, ['555:1'], true);
    expect(out.match(/tg-bridge/g)).toHaveLength(1);
  });

  it('never touches tags without ensureTag — an existing note is the user’s', () => {
    const existing = '---\naliases:\n  - x\n---\nbody\n';
    const out = writeSyncedIds(existing, ['555:1']);
    expect(out).not.toContain('tg-bridge');
  });
});

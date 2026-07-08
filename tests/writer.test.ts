import { describe, expect, it } from 'vitest';
import { applyEntries, insertUnderHeading, type NoteEntry } from '../src/vault/writer';
import { readSyncedIds } from '../src/vault/frontmatter';

const H = '## Telegram';
const entry = (key: string, ...lines: string[]): NoteEntry => ({ key, lines });

describe('insertUnderHeading — heading absent', () => {
  it('creates the heading at the end of an empty note', () => {
    expect(insertUnderHeading('', H, ['a'])).toBe('## Telegram\n\na\n');
  });

  it('appends the heading after existing content, separated by one blank line', () => {
    expect(insertUnderHeading('# Day\n\nsome prose\n', H, ['a'])).toBe(
      '# Day\n\nsome prose\n\n## Telegram\n\na\n',
    );
  });

  it('collapses trailing blank lines rather than accumulating them', () => {
    expect(insertUnderHeading('# Day\n\n\n\n', H, ['a'])).toBe('# Day\n\n## Telegram\n\na\n');
  });

  it('skips frontmatter when looking for the heading', () => {
    const out = insertUnderHeading('---\ntags:\n  - x\n---\n\nprose\n', H, ['a']);
    expect(out.startsWith('---\ntags:\n  - x\n---\n')).toBe(true);
    expect(out).toContain('## Telegram\n\na');
  });

  it('does not treat a heading inside frontmatter as ours', () => {
    const out = insertUnderHeading('---\ntitle: "## Telegram"\n---\nbody\n', H, ['a']);
    expect(out.match(/^## Telegram$/gm)).toHaveLength(1);
  });
});

describe('insertUnderHeading — heading present', () => {
  it('appends at the end of the section, separated by a blank line', () => {
    // Without bullets, two adjacent lines are one paragraph. The blank is load-bearing.
    expect(insertUnderHeading('## Telegram\n\nold\n', H, ['new'])).toBe('## Telegram\n\nold\n\nnew\n');
  });

  it('does not add a blank line when the section is empty', () => {
    expect(insertUnderHeading('## Telegram\n', H, ['a'])).toBe('## Telegram\na\n');
  });

  it('stops at the next same-level heading', () => {
    const before = '## Telegram\n\nold\n\n## Notes\nkeep me\n';
    expect(insertUnderHeading(before, H, ['new'])).toBe('## Telegram\n\nold\n\nnew\n\n## Notes\nkeep me\n');
  });

  it('stops at a shallower heading', () => {
    expect(insertUnderHeading('## Telegram\n\nold\n\n# Tomorrow\n', H, ['new'])).toBe(
      '## Telegram\n\nold\n\nnew\n\n# Tomorrow\n',
    );
  });

  it('does NOT stop at a deeper heading — a subsection belongs to the section', () => {
    expect(insertUnderHeading('## Telegram\n\nold\n\n### Sub\ndetail\n', H, ['new'])).toBe(
      '## Telegram\n\nold\n\n### Sub\ndetail\n\nnew\n',
    );
  });

  it('does not accumulate blank lines across repeated appends', () => {
    let c = '## Telegram\n';
    for (const line of ['a', 'b', 'c']) c = insertUnderHeading(c, H, [line]);
    expect(c).toBe('## Telegram\na\n\nb\n\nc\n');
  });

  it('writes below prose the user typed under the heading', () => {
    expect(insertUnderHeading('## Telegram\n\nmy own note\n', H, ['new'])).toBe(
      '## Telegram\n\nmy own note\n\nnew\n',
    );
  });

  it('supports a level-1 heading', () => {
    expect(insertUnderHeading('# TG\n\nold\n\n# Other\n', '# TG', ['new'])).toBe(
      '# TG\n\nold\n\nnew\n\n# Other\n',
    );
  });
});

describe('insertUnderHeading — code fences', () => {
  it('ignores a heading-shaped line inside a fenced block', () => {
    // In `code` block style every entry we write is a fence, and a pasted shell
    // script would otherwise truncate the section at its `# comment`.
    const before = '## Telegram\n\n```sh\n# Notes\necho hi\n```\n';
    expect(insertUnderHeading(before, H, ['new'])).toBe(
      '## Telegram\n\n```sh\n# Notes\necho hi\n```\n\nnew\n',
    );
  });

  it('does not match the target heading inside a fence', () => {
    const out = insertUnderHeading('```\n## Telegram\n```\n\nprose\n', H, ['a']);
    expect(out).toBe('```\n## Telegram\n```\n\nprose\n\n## Telegram\n\na\n');
  });

  it('handles tilde fences', () => {
    expect(insertUnderHeading('## Telegram\n~~~\n# nope\n~~~\n', H, ['a'])).toBe(
      '## Telegram\n~~~\n# nope\n~~~\n\na\n',
    );
  });

  it('does not let a ~~~ close a ``` fence', () => {
    const before = '## Telegram\n```\n~~~\n# nope\n```\n';
    expect(insertUnderHeading(before, H, ['a'])).toBe('## Telegram\n```\n~~~\n# nope\n```\n\na\n');
  });

  it('handles a four-backtick fence containing a three-backtick one', () => {
    // This is exactly what `code` block style writes when the message itself
    // contains a fence. A scanner that closes on the first ``` would leak.
    const before = '## Telegram\n````\n```\n# nope\n```\n````\n';
    expect(insertUnderHeading(before, H, ['a'])).toBe('## Telegram\n````\n```\n# nope\n```\n````\n\na\n');
  });

  it('does not let a shorter fence close a longer one', () => {
    const before = '## Telegram\n````\n```\n````\n\nold\n';
    expect(insertUnderHeading(before, H, ['a'])).toBe('## Telegram\n````\n```\n````\n\nold\n\na\n');
  });
});

describe('insertUnderHeading — degenerate input', () => {
  it('is a no-op for zero lines', () => {
    expect(insertUnderHeading('## Telegram\nold\n', H, [])).toBe('## Telegram\nold\n');
  });

  it('matches a heading with surrounding whitespace and leaves the user’s line untouched', () => {
    // Matching is whitespace-insensitive; rewriting is not our business.
    expect(insertUnderHeading('##  Telegram \n', '##  Telegram ', ['a'])).toBe('##  Telegram \na\n');
  });

  it('does not match a heading that merely starts with the same words', () => {
    expect(insertUnderHeading('## Telegram archive\nold\n', H, ['a'])).toBe(
      '## Telegram archive\nold\n\n## Telegram\n\na\n',
    );
  });

  it('always leaves exactly one trailing newline', () => {
    for (const before of ['', '## Telegram\n', '## Telegram\nx\n', 'prose']) {
      const out = insertUnderHeading(before, H, ['a']);
      expect(out.endsWith('\n')).toBe(true);
      expect(out.endsWith('\n\n')).toBe(false);
    }
  });
});

describe('applyEntries', () => {
  it('writes an entry and records its id', () => {
    const { content, written } = applyEntries('', H, [entry('1:2', 'hello')]);
    expect(written).toBe(1);
    expect(readSyncedIds(content)).toEqual(new Set(['1:2']));
    expect(content).toBe('---\ntags:\n  - tg-bridge\ntg_ids:\n  - "1:2"\n---\n## Telegram\n\nhello\n');
  });

  it('leaves nothing in the body but the message', () => {
    const { content } = applyEntries('', H, [entry('1:2', 'hello')]);
    expect(content).not.toContain('%%');
    expect(content.split('---\n')[2]).toBe('## Telegram\n\nhello\n');
  });

  it('drops an entry already recorded in frontmatter', () => {
    const before = '---\ntg_ids:\n  - "1:2"\n---\n## Telegram\n\nhello\n';
    const { content, written } = applyEntries(before, H, [entry('1:2', 'hello')]);
    expect(written).toBe(0);
    expect(content).toBe(before);
  });

  it('drops an entry recorded by the old inline marker — a v1 note must not re-sync', () => {
    const before = '## Telegram\n\n- 15:29 hello %%tg:1:2%%\n';
    const { content, written } = applyEntries(before, H, [entry('1:2', 'hello')]);
    expect(written).toBe(0);
    expect(content).toBe(before);
  });

  it('writes a new entry into a v1 note without disturbing the old markers', () => {
    const before = '## Telegram\n\n- 15:29 old %%tg:1:2%%\n';
    const { content, written } = applyEntries(before, H, [entry('1:3', 'new')]);
    expect(written).toBe(1);
    expect(content).toContain('%%tg:1:2%%'); // the user's body is left alone
    expect(readSyncedIds(content)).toEqual(new Set(['1:3'])); // only new ids are recorded
  });

  it('deduplicates within a single batch', () => {
    const { written, content } = applyEntries('', H, [entry('1:2', 'a'), entry('1:2', 'a')]);
    expect(written).toBe(1);
    expect(content.match(/^a$/gm)).toHaveLength(1);
  });

  it('accumulates ids across calls', () => {
    let c = '';
    for (const [key, text] of [['1:1', 'a'], ['1:2', 'b'], ['1:3', 'c']] as const) {
      c = applyEntries(c, H, [entry(key, text)]).content;
    }
    expect(readSyncedIds(c)).toEqual(new Set(['1:1', '1:2', '1:3']));
    expect(c.match(/tg_ids:/g)).toHaveLength(1);
    expect(c).toContain('## Telegram\n\na\n\nb\n\nc\n');
  });

  it('separates multi-line entries with one blank line', () => {
    const { content } = applyEntries('', H, [entry('1:1', 'a', 'a2'), entry('1:2', 'b')]);
    expect(content).toContain('## Telegram\n\na\na2\n\nb\n');
  });

  it('is a no-op when every entry is a duplicate', () => {
    const before = applyEntries('', H, [entry('1:1', 'a')]).content;
    const after = applyEntries(before, H, [entry('1:1', 'a')]);
    expect(after.written).toBe(0);
    expect(after.content).toBe(before);
  });

  it('handles zero entries', () => {
    expect(applyEntries('body', H, [])).toEqual({ content: 'body', written: 0 });
  });

  it('writes code-block entries without the fence eating the section', () => {
    const e1 = entry('1:1', '```', 'code', '```');
    const e2 = entry('1:2', '```', '# not a heading', '```');
    const { content, written } = applyEntries(applyEntries('', H, [e1]).content, H, [e2]);
    expect(written).toBe(1);
    expect(content).toContain('```\ncode\n```\n\n```\n# not a heading\n```\n');
  });
});

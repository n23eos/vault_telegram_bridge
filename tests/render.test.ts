import { describe, expect, it } from 'vitest';
import { fenceFor, joinEntries, renderEntry, sanitizeInline, type RenderOptions } from '../src/sync/render';

const ZWSP = '​';
const ctx = { time: '15:29', date: '2026-07-08' };

const opts = (o: Partial<RenderOptions> = {}): RenderOptions => ({
  template: '**{time}** {text}',
  blockStyle: 'plain',
  calloutType: 'note',
  ...o,
});

describe('renderEntry — plain', () => {
  it('substitutes the template', () => {
    expect(renderEntry('an idea', opts(), ctx)).toEqual(['**15:29** an idea']);
  });

  it('lets the user put an emoji anywhere in the template', () => {
    expect(renderEntry('an idea', opts({ template: '✏️ **{time}** {text}' }), ctx)).toEqual([
      '✏️ **15:29** an idea',
    ]);
  });

  it('lets the user keep a bullet if they want one', () => {
    expect(renderEntry('an idea', opts({ template: '- {time} {text}' }), ctx)).toEqual(['- 15:29 an idea']);
  });

  it('substitutes {date}', () => {
    expect(renderEntry('x', opts({ template: '{date} {time} {text}' }), ctx)).toEqual([
      '2026-07-08 15:29 x',
    ]);
  });

  it('substitutes every occurrence of a placeholder', () => {
    expect(renderEntry('x', opts({ template: '{time} {time} {text}' }), ctx)).toEqual(['15:29 15:29 x']);
  });

  it('keeps a multi-line message as one entry with one timestamp', () => {
    expect(renderEntry('first\nsecond\nthird', opts(), ctx)).toEqual([
      '**15:29** first',
      'second',
      'third',
    ]);
  });

  it('handles an empty message', () => {
    expect(renderEntry('', opts(), ctx)).toEqual(['**15:29**']);
  });

  it('trims trailing whitespace but not the text itself', () => {
    expect(renderEntry('a  \n b ', opts(), ctx)).toEqual(['**15:29** a', ' b']);
  });
});

describe('renderEntry — plain, hostile bodies', () => {
  it('breaks a double percent that would open an Obsidian comment', () => {
    // Without this, everything after `%%` vanishes from Reading View.
    expect(renderEntry('50%% off', opts(), ctx)).toEqual([`**15:29** 50%${ZWSP}% off`]);
  });

  it('breaks an opening HTML comment', () => {
    expect(renderEntry('<!-- hi', opts(), ctx)).toEqual([`**15:29** <!${ZWSP}-- hi`]);
  });

  it('breaks a closing HTML comment', () => {
    expect(renderEntry('a --> b', opts(), ctx)).toEqual([`**15:29** a --${ZWSP}> b`]);
  });

  it('handles odd runs of percent signs', () => {
    expect(/%%/.test(renderEntry('%%%', opts(), ctx)[0])).toBe(false);
    expect(/%%/.test(renderEntry('%%%%', opts(), ctx)[0])).toBe(false);
  });

  it('deletes no visible character while sanitising', () => {
    const s = '%%--><!--';
    expect(sanitizeInline(s).replaceAll(ZWSP, '')).toBe(s);
  });

  it('is idempotent', () => {
    for (const s of ['100%% off', 'a --> b', '<!-- hi', '%%%']) {
      expect(sanitizeInline(sanitizeInline(s))).toBe(sanitizeInline(s));
    }
  });

  it('leaves ordinary text alone', () => {
    expect(sanitizeInline('50% off, a - b, x > y')).toBe('50% off, a - b, x > y');
  });
});

describe('fenceFor', () => {
  it('uses three backticks for ordinary text', () => {
    expect(fenceFor('hello')).toBe('```');
    expect(fenceFor('a `code` span')).toBe('```');
  });

  it('outgrows a fence the message already contains', () => {
    expect(fenceFor('```js\nx\n```')).toBe('````');
    expect(fenceFor('````')).toBe('`````');
  });

  it('measures the longest run, not the count of runs', () => {
    expect(fenceFor('` `` ```')).toBe('````');
  });
});

describe('renderEntry — code block', () => {
  it('wraps the entry in a fence', () => {
    expect(renderEntry('an idea', opts({ blockStyle: 'code' }), ctx)).toEqual([
      '```',
      '**15:29** an idea',
      '```',
    ]);
  });

  it('does not sanitise, because Markdown is inert inside a fence', () => {
    const out = renderEntry('50%% off', opts({ blockStyle: 'code' }), ctx);
    expect(out[1]).toBe('**15:29** 50%% off');
    expect(out[1]).not.toContain(ZWSP);
  });

  it('grows the fence when the message would close it', () => {
    const out = renderEntry('```\ncode\n```', opts({ blockStyle: 'code' }), ctx);
    expect(out[0]).toBe('````');
    expect(out[out.length - 1]).toBe('````');
    expect(out).toEqual(['````', '**15:29** ```', 'code', '```', '````']);
  });

  it('accounts for backticks in the template as well as the text', () => {
    const out = renderEntry('x', opts({ blockStyle: 'code', template: '```{time}``` {text}' }), ctx);
    expect(out[0]).toBe('````');
  });

  it('keeps a multi-line message inside one fence', () => {
    expect(renderEntry('a\nb', opts({ blockStyle: 'code' }), ctx)).toEqual([
      '```',
      '**15:29** a',
      'b',
      '```',
    ]);
  });
});

describe('renderEntry — callout', () => {
  it('opens a callout and prefixes every line', () => {
    expect(renderEntry('an idea', opts({ blockStyle: 'callout' }), ctx)).toEqual([
      '> [!note]',
      '> **15:29** an idea',
    ]);
  });

  it('honours the callout type', () => {
    expect(renderEntry('x', opts({ blockStyle: 'callout', calloutType: 'tip' }), ctx)[0]).toBe('> [!tip]');
  });

  it('falls back to note for an empty type', () => {
    expect(renderEntry('x', opts({ blockStyle: 'callout', calloutType: '  ' }), ctx)[0]).toBe('> [!note]');
  });

  it('uses a bare > for a blank line, or the callout would end there', () => {
    expect(renderEntry('a\n\nb', opts({ blockStyle: 'callout' }), ctx)).toEqual([
      '> [!note]',
      '> **15:29** a',
      '>',
      '> b',
    ]);
  });

  it('sanitises, because Markdown is live inside a callout', () => {
    expect(renderEntry('50%% off', opts({ blockStyle: 'callout' }), ctx)[1]).toContain(ZWSP);
  });
});

describe('joinEntries', () => {
  it('separates entries with exactly one blank line', () => {
    // Not decoration: without bullets, adjacent lines are one Markdown paragraph.
    expect(joinEntries([['a'], ['b']])).toEqual(['a', '', 'b']);
  });

  it('adds no leading or trailing blank line', () => {
    const out = joinEntries([['a'], ['b']]);
    expect(out[0]).toBe('a');
    expect(out[out.length - 1]).toBe('b');
  });

  it('handles a single entry', () => {
    expect(joinEntries([['a', 'b']])).toEqual(['a', 'b']);
  });

  it('handles no entries', () => {
    expect(joinEntries([])).toEqual([]);
  });

  it('separates code blocks so they do not merge', () => {
    expect(joinEntries([['```', 'a', '```'], ['```', 'b', '```']])).toEqual([
      '```',
      'a',
      '```',
      '',
      '```',
      'b',
      '```',
    ]);
  });
});

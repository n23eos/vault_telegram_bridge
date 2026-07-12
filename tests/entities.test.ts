import { describe, expect, it } from 'vitest';
import { entitiesToMarkdown } from '../src/telegram/entities';
import type { TgEntity } from '../src/telegram/types';

const e = (type: string, offset: number, length: number, extra: Partial<TgEntity> = {}): TgEntity => ({
  type,
  offset,
  length,
  ...extra,
});

describe('entitiesToMarkdown — basics', () => {
  it('returns the text untouched when there are no entities', () => {
    expect(entitiesToMarkdown('plain text', undefined)).toBe('plain text');
    expect(entitiesToMarkdown('plain text', [])).toBe('plain text');
  });

  it('converts bold', () => {
    expect(entitiesToMarkdown('a bold word', [e('bold', 2, 4)])).toBe('a **bold** word');
  });

  it('converts italic', () => {
    expect(entitiesToMarkdown('an italic word', [e('italic', 3, 6)])).toBe('an *italic* word');
  });

  it('converts strikethrough', () => {
    expect(entitiesToMarkdown('so wrong', [e('strikethrough', 3, 5)])).toBe('so ~~wrong~~');
  });

  it('converts inline code', () => {
    expect(entitiesToMarkdown('run npm test now', [e('code', 4, 8)])).toBe('run `npm test` now');
  });

  it('converts a text_link into a Markdown link', () => {
    expect(entitiesToMarkdown('see docs here', [e('text_link', 9, 4, { url: 'https://x.dev' })])).toBe(
      'see docs [here](https://x.dev)',
    );
  });

  it('drops a text_link without a url rather than writing [text]()', () => {
    expect(entitiesToMarkdown('see here', [e('text_link', 4, 4)])).toBe('see here');
  });

  it('leaves url, mention and hashtag entities alone — the text already reads right', () => {
    const text = 'see https://x.dev @user #tag';
    const ents = [e('url', 4, 13), e('mention', 18, 5), e('hashtag', 24, 4)];
    expect(entitiesToMarkdown(text, ents)).toBe(text);
  });

  it('converts a pre block into a fence, keeping the language', () => {
    const text = 'look:\nconst a = 1;';
    expect(entitiesToMarkdown(text, [e('pre', 6, 12, { language: 'js' })])).toBe(
      'look:\n\n```js\nconst a = 1;\n```\n',
    );
  });

  it('converts a blockquote into > lines', () => {
    expect(entitiesToMarkdown('he said\nthis\nand that', [e('blockquote', 8, 13)])).toBe(
      'he said\n> this\n> and that',
    );
  });
});

describe('entitiesToMarkdown — edges', () => {
  it('handles adjacent entities', () => {
    const r = entitiesToMarkdown('one two', [e('bold', 0, 3), e('italic', 4, 3)]);
    expect(r).toBe('**one** *two*');
  });

  it('handles nested entities (italic inside bold)', () => {
    // "bold and italic" — bold covers all, italic covers "italic"
    const r = entitiesToMarkdown('bold and italic', [e('bold', 0, 15), e('italic', 9, 6)]);
    expect(r).toBe('**bold and *italic***');
  });

  it('uses UTF-16 offsets, as Telegram does — emoji count as two units', () => {
    // '🔥 hot' — 🔥 is 2 UTF-16 units, so "hot" starts at offset 3
    expect(entitiesToMarkdown('🔥 hot', [e('bold', 3, 3)])).toBe('🔥 **hot**');
  });

  it('moves boundary whitespace outside emphasis markers — `**bold **` does not render', () => {
    expect(entitiesToMarkdown('a bold  b', [e('bold', 2, 6)])).toBe('a **bold**  b');
  });

  it('skips an entity that is pure whitespace', () => {
    expect(entitiesToMarkdown('a   b', [e('bold', 1, 3)])).toBe('a   b');
  });

  it('wraps inline code containing backticks in a longer run', () => {
    expect(entitiesToMarkdown('x `a` y', [e('code', 2, 3)])).toBe('x `` `a` `` y');
  });

  it('ignores an entity that runs past the end of the text', () => {
    expect(entitiesToMarkdown('short', [e('bold', 3, 99)])).toBe('short');
  });

  it('ignores overlapping (non-nested) entities instead of corrupting the text', () => {
    // bold [0,5), italic [3,8) — malformed per Telegram's own contract
    const r = entitiesToMarkdown('abcdefgh', [e('bold', 0, 5), e('italic', 3, 5)]);
    expect(r).toBe('**abcde**fgh');
  });
});

describe('entitiesToMarkdown — text_link escaping (review fix)', () => {
  it('escapes ] in the link text', () => {
    expect(entitiesToMarkdown('see 1] now', [e('text_link', 4, 2, { url: 'https://x.dev' })])).toBe(
      'see [1\\]](https://x.dev) now',
    );
  });

  it('percent-escapes parentheses in the URL', () => {
    expect(entitiesToMarkdown('wiki', [e('text_link', 0, 4, { url: 'https://x.dev/foo(1)' })])).toBe(
      '[wiki](https://x.dev/foo%281%29)',
    );
  });

  it('percent-escapes spaces in the URL', () => {
    expect(entitiesToMarkdown('doc', [e('text_link', 0, 3, { url: 'https://x.dev/a b' })])).toBe(
      '[doc](https://x.dev/a%20b)',
    );
  });
});

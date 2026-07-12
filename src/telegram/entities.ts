import { fenceFor } from '../sync/render';
import type { TgEntity } from './types';

/**
 * Telegram formatting → Markdown.
 *
 * Telegram sends formatting out-of-band: plain text plus an array of entities,
 * each an `offset`/`length` span in UTF-16 code units — which is exactly how
 * JavaScript indexes strings, so no re-counting is needed. Entities either nest
 * or are disjoint, never partially overlap; anything that violates that
 * contract is ignored rather than guessed at.
 *
 * Only entities that *change meaning* when dropped are converted. `url`,
 * `mention` and `hashtag` spans already read correctly as plain text; `bold`
 * without markers is silently lost, and a `text_link` loses its URL entirely.
 */

export function entitiesToMarkdown(text: string, entities: readonly TgEntity[] | undefined): string {
  if (!entities || entities.length === 0) return text;
  // Outer-first: same offset → longer entity is the parent.
  const sorted = [...entities].sort((a, b) => a.offset - b.offset || b.length - a.length);
  return renderRange(text, sorted, 0, text.length);
}

function renderRange(text: string, entities: readonly TgEntity[], start: number, end: number): string {
  let out = '';
  let pos = start;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    // Children of an entity already rendered, or an overlap: both start before
    // `pos` and are skipped — the recursion below is what consumes children.
    if (e.offset < pos) continue;
    if (e.offset >= end) break;
    const entityEnd = e.offset + e.length;
    if (entityEnd > end) continue; // runs past the boundary — malformed

    out += text.slice(pos, e.offset);
    const children = entities.slice(i + 1).filter((c) => c.offset >= e.offset && c.offset + c.length <= entityEnd);
    out += wrap(renderRange(text, children, e.offset, entityEnd), e);
    pos = entityEnd;
  }

  return out + text.slice(pos, end);
}

function wrap(inner: string, e: TgEntity): string {
  switch (e.type) {
    case 'bold':
      return emphasize(inner, '**');
    case 'italic':
      return emphasize(inner, '*');
    case 'strikethrough':
      return emphasize(inner, '~~');
    case 'code':
      return inlineCode(inner);
    case 'pre':
      return preBlock(inner, e.language);
    case 'text_link':
      return e.url ? markdownLink(inner, e.url) : inner;
    case 'blockquote':
    case 'expandable_blockquote':
      return inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    default:
      // url, mention, hashtag, bot_command, underline, spoiler, custom_emoji, …
      // — either already legible as plain text or without a Markdown equivalent.
      return inner;
  }
}

/**
 * A `]` in the text or a `(`/`)`/space in the URL terminates a Markdown link
 * early and loses the URL — the exact loss this conversion exists to prevent.
 * The text escapes its brackets; the URL percent-escapes the three offenders,
 * which every server decodes back to the same resource.
 */
function markdownLink(inner: string, url: string): string {
  const safeText = inner.replace(/\]/g, '\\]');
  const safeUrl = url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
  return `[${safeText}](${safeUrl})`;
}

/**
 * `**bold **` is not emphasis in Markdown — the closing marker must hug a
 * non-space. Telegram happily produces entities with boundary whitespace, so
 * the whitespace moves outside the markers.
 */
function emphasize(inner: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m || m[2] === '') return inner;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

/** A backtick run one longer than any inside, padded when the content itself starts or ends with one. */
function inlineCode(inner: string): string {
  const runs = inner.match(/`+/g) ?? [];
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
  const ticks = '`'.repeat(Math.max(1, longest + 1));
  const pad = inner.startsWith('`') || inner.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${inner}${pad}${ticks}`;
}

/** Fences need their own lines; the surrounding newlines are trimmed back later by the renderer. */
function preBlock(inner: string, language: string | undefined): string {
  const fence = fenceFor(inner);
  return `\n${fence}${language ?? ''}\n${inner}\n${fence}\n`;
}

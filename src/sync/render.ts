/**
 * Turning one Telegram message into Markdown lines.
 *
 * The template is a single setting rather than five checkboxes: a user who wants
 * `✏️ **{time}** {text}` can write it, and a user who wants a bullet can write
 * `- {time} {text}`. Adding a knob per decoration would have covered fewer cases
 * with more code.
 */

const ZWSP = '​';

export type BlockStyle = 'plain' | 'code' | 'callout';

export interface RenderOptions {
  /** `{time}`, `{date}` and `{text}` are substituted. Anything else is literal. */
  template: string;
  blockStyle: BlockStyle;
  /** Only read when `blockStyle` is `callout`. `note`, `tip`, `quote`, … */
  calloutType: string;
}

export interface RenderContext {
  time: string;
  date: string;
}

/**
 * Neutralise Markdown that would swallow the rest of the note.
 *
 * A lone `%%` opens an Obsidian block comment and hides everything after it — a
 * user who writes "50%% off" would watch the rest of their day disappear from
 * Reading View. `<!--` does the same. We insert a zero-width space between the
 * offending characters: nothing is deleted, the text looks identical, and the
 * comment never opens.
 *
 * Lookahead rather than literal replacement, so `%%%` and repeated application
 * both behave: after one pass no `%` is followed by `%`, so a second pass is a
 * no-op.
 *
 * Not applied inside a code block, where Markdown is inert and mangling the
 * user's text would be gratuitous. See `wrapCode` for that case's own hazard.
 */
export function sanitizeInline(text: string): string {
  return text
    .replace(/%(?=%)/g, `%${ZWSP}`)
    .replace(/--(?=>)/g, `--${ZWSP}`)
    .replace(/<!(?=--)/g, `<!${ZWSP}`);
}

/**
 * The shortest fence that the text cannot close. A message containing ``` gets
 * wrapped in ````, and so on. Truncating or escaping the user's backticks would
 * be worse than a longer fence.
 */
export function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function applyTemplate(template: string, ctx: RenderContext, firstLine: string): string {
  return template
    .replace(/\{time\}/g, ctx.time)
    .replace(/\{date\}/g, ctx.date)
    .replace(/\{text\}/g, firstLine)
    .trimEnd();
}

/**
 * The first line of the message goes through the template; the rest follow it
 * verbatim, so a multi-line message stays one entry with one timestamp.
 */
function templated(text: string, opts: RenderOptions, ctx: RenderContext): string[] {
  const [first = '', ...rest] = text.split('\n');
  return [applyTemplate(opts.template, ctx, first), ...rest.map((l) => l.trimEnd())];
}

function wrapCode(lines: string[], text: string): string[] {
  const fence = fenceFor(text);
  return [fence, ...lines, fence];
}

function wrapCallout(lines: string[], calloutType: string): string[] {
  const type = calloutType.trim() || 'note';
  // A blank line inside a callout must be `>`, not `> `, or the callout ends.
  return [`> [!${type}]`, ...lines.map((l) => (l.trim() === '' ? '>' : `> ${l}`))];
}

/** The Markdown for one message. Never contains a trailing blank line. */
export function renderEntry(text: string, opts: RenderOptions, ctx: RenderContext): string[] {
  if (opts.blockStyle === 'code') {
    // Inside a fence nothing is interpreted, so the text is written untouched.
    // The only hazard is the fence itself, and `fenceFor` handles it.
    return wrapCode(templated(text, opts, ctx), text + opts.template);
  }

  const lines = templated(sanitizeInline(text), opts, ctx);
  return opts.blockStyle === 'callout' ? wrapCallout(lines, opts.calloutType) : lines;
}

/**
 * Entries, separated by one blank line.
 *
 * The blank line is not decoration. Without bullets, two consecutive lines are
 * one Markdown paragraph, and `15:29 a` / `15:30 b` would render as
 * `15:29 a 15:30 b` on a single line. Code blocks and callouts need the
 * separation too, or they merge into one block.
 */
export function joinEntries(entries: string[][]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (out.length > 0) out.push('');
    out.push(...entry);
  }
  return out;
}

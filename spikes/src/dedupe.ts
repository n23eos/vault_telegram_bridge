/**
 * Spike 0.2 — dedupe marker format.
 *
 * Candidate A (recommended, pending manual render check):
 *   `- 14:03 message text %%tg:777000:12345%%`
 *   Obsidian-native inline comment, opened and closed on the same line.
 *
 * Candidate B (fallback):
 *   `- 14:03 message text <!-- tg:777000:12345 -->`
 *   Standard HTML comment. Renders as nothing in Obsidian and everywhere else,
 *   but is visible in Reading View source and survives copy-paste as text.
 *
 * See docs/SPIKE-REPORT.md 0.2 for the render matrix and the verdict.
 *
 * ---
 *
 * Escaping hazard, both candidates:
 *
 * A `%%` inside the message body opens an Obsidian comment that swallows the
 * rest of the line — including our marker. Likewise `-->` inside the body
 * closes an HTML comment early. Message text is attacker-controlled in the
 * loosest sense (the user can paste anything), so it MUST be neutralised
 * before it is written next to a marker.
 *
 * We insert U+200B (zero-width space) between the two percent signs. The text
 * looks identical to the reader, no characters are removed, and the comment
 * never opens. Same trick for `-->`.
 */

export interface MsgRef {
  chatId: string;
  messageId: number;
}

export type MarkerStyle = 'obsidian-comment' | 'html-comment';

const ZWSP = '​';

/** Matches `%%tg:<chatId>:<messageId>%%` — chatId may be negative (channels). */
const OBSIDIAN_MARKER_RE = /%%tg:(-?\d+):(\d+)%%/g;

/** Matches `<!-- tg:<chatId>:<messageId> -->` with flexible inner whitespace. */
const HTML_MARKER_RE = /<!--\s*tg:(-?\d+):(\d+)\s*-->/g;

export function markerFor(ref: MsgRef, style: MarkerStyle = 'obsidian-comment'): string {
  if (!Number.isInteger(ref.messageId) || ref.messageId < 0) {
    throw new Error(`invalid messageId: ${ref.messageId}`);
  }
  if (!/^-?\d+$/.test(ref.chatId)) {
    throw new Error(`invalid chatId: ${ref.chatId}`);
  }
  return style === 'obsidian-comment'
    ? `%%tg:${ref.chatId}:${ref.messageId}%%`
    : `<!-- tg:${ref.chatId}:${ref.messageId} -->`;
}

/**
 * Every marker present in the note, in `<chatId>:<messageId>` canonical form.
 * Both styles are recognised regardless of which one we currently write, so a
 * format change in a later version does not resurrect already-synced messages.
 */
export function extractMarkers(noteContent: string): Set<string> {
  const found = new Set<string>();
  for (const re of [OBSIDIAN_MARKER_RE, HTML_MARKER_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noteContent)) !== null) found.add(`${m[1]}:${m[2]}`);
  }
  return found;
}

export function markerKey(ref: MsgRef): string {
  return `${ref.chatId}:${ref.messageId}`;
}

export function hasMarker(noteContent: string, ref: MsgRef): boolean {
  return extractMarkers(noteContent).has(markerKey(ref));
}

/**
 * Neutralise comment delimiters that a user's own message text could contain.
 *
 * Implemented with lookahead rather than literal replacement so that odd runs
 * (`%%%`) and repeated application are both handled: after one pass no `%` is
 * immediately followed by `%`, so a second pass is a no-op. Same for `--` + `>`
 * and `<!` + `--`.
 */
export function sanitizeBody(text: string): string {
  return text
    .replace(/%(?=%)/g, `%${ZWSP}`)
    .replace(/--(?=>)/g, `--${ZWSP}`)
    .replace(/<!(?=--)/g, `<!${ZWSP}`);
}

/**
 * Multi-line messages become one list item: the first line carries the bullet
 * and the marker, continuation lines are indented two spaces so Markdown keeps
 * them inside the same `<li>`. Exactly one marker per message.
 */
export function formatMessageLines(
  ref: MsgRef,
  time: string,
  body: string,
  style: MarkerStyle = 'obsidian-comment',
): string[] {
  const safe = sanitizeBody(body);
  const [first = '', ...rest] = safe.split('\n');
  const head = `- ${time} ${first}`.trimEnd();
  const lines = [`${head} ${markerFor(ref, style)}`];
  for (const line of rest) lines.push(`  ${line}`.trimEnd());
  return lines;
}

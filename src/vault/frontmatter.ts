/**
 * Deduplication records live in the note's YAML frontmatter, under `tg_ids`.
 *
 * They used to be inline `%%tg:chat:id%%` comments in the body. Three reasons
 * they moved:
 *
 *   - a code-block entry shows its contents verbatim, so an inline comment
 *     would be plainly visible;
 *   - the body is the user's text, and we were writing bookkeeping into it;
 *   - frontmatter is hidden in Reading View and, unlike `data.json`, travels
 *     with the note — which is the whole point (SPEC §5а): a desktop and a
 *     phone syncing one vault must agree on what has already been written.
 *
 * `extractMarkers` in `sync/dedupe.ts` still reads the old inline format, so a
 * note written by an earlier version is never re-synced.
 *
 * Hand-rolled rather than YAML-parsed: we touch exactly one key and must leave
 * every other line — including comments, aliases and whatever plugin wrote them
 * — byte-for-byte intact. A parse-and-reserialise round trip would not.
 */

export const SYNCED_IDS_KEY = 'tg_ids';
export const DEFAULT_TAG = 'tg-bridge';

interface Frontmatter {
  /** Lines between the delimiters, exclusive. */
  lines: string[];
  /** Index of the line after the closing `---`. */
  bodyStart: number;
  exists: boolean;
}

/** Frontmatter only counts when `---` is the very first line. */
function parse(content: string): Frontmatter {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return { lines: [], bodyStart: 0, exists: false };

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { lines: lines.slice(1, i), bodyStart: i + 1, exists: true };
    }
  }
  // An unterminated `---` is not frontmatter; it is a horizontal rule.
  return { lines: [], bodyStart: 0, exists: false };
}

/** True for `key:` at the top level of the block (no indentation). */
function isKeyLine(line: string, key: string): boolean {
  return new RegExp(`^${key}\\s*:`).test(line);
}

/** True for a line that belongs to the previous key's block: indented, or a `- ` item. */
function isContinuation(line: string): boolean {
  return /^\s+\S/.test(line) || /^-\s/.test(line);
}

const ITEM = /^\s*-\s*(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/;

/** `["a:1", "b:2"]` — the flow style Obsidian writes when you edit properties by hand. */
function parseFlowList(rest: string): string[] | null {
  const m = /^\s*\[(.*)\]\s*$/.exec(rest);
  if (!m) return null;
  if (m[1].trim() === '') return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s !== '');
}

/** Every id recorded in this note. Empty set for a note with no frontmatter. */
export function readSyncedIds(content: string): Set<string> {
  const fm = parse(content);
  const out = new Set<string>();
  if (!fm.exists) return out;

  for (let i = 0; i < fm.lines.length; i++) {
    if (!isKeyLine(fm.lines[i], SYNCED_IDS_KEY)) continue;

    const rest = fm.lines[i].slice(fm.lines[i].indexOf(':') + 1);
    const flow = parseFlowList(rest);
    if (flow) {
      flow.forEach((v) => out.add(v));
      return out;
    }

    for (let j = i + 1; j < fm.lines.length && isContinuation(fm.lines[j]); j++) {
      const m = ITEM.exec(fm.lines[j]);
      const value = m?.[1] ?? m?.[2] ?? m?.[3];
      if (value) out.add(value);
    }
    return out;
  }
  return out;
}

/** The `tg_ids:` key and the list items beneath it, as lines. */
function renderIds(ids: Iterable<string>): string[] {
  // Quoted, always. `699033959:6` unquoted is a colon inside a plain scalar —
  // legal today, and one YAML parser away from being read as a mapping.
  return [`${SYNCED_IDS_KEY}:`, ...[...ids].map((id) => `  - "${id}"`)];
}

/**
 * Returns `content` with `tg_ids` set to `ids`, creating frontmatter if absent.
 * Every other frontmatter line is preserved exactly.
 *
 * A new note is also tagged `tg-bridge`, so the day-notes are findable and a
 * Dataview query can collect them. An existing note's tags are never touched.
 */
export function writeSyncedIds(content: string, ids: Iterable<string>): string {
  const idList = [...ids];
  const fm = parse(content);

  if (!fm.exists) {
    const header = ['---', 'tags:', `  - ${DEFAULT_TAG}`, ...renderIds(idList), '---'];
    return `${header.join('\n')}\n${content}`;
  }

  const kept: string[] = [];
  for (let i = 0; i < fm.lines.length; i++) {
    if (isKeyLine(fm.lines[i], SYNCED_IDS_KEY)) {
      // Skip the key and whatever block hangs off it.
      let j = i + 1;
      while (j < fm.lines.length && isContinuation(fm.lines[j])) j++;
      i = j - 1;
      continue;
    }
    kept.push(fm.lines[i]);
  }

  // Drop blank lines that the removal left at the end of the block.
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  const body = content.split('\n').slice(fm.bodyStart);
  return ['---', ...kept, ...renderIds(idList), '---', ...body].join('\n');
}

/** Where the body begins, so callers can operate on it without the frontmatter. */
export function splitFrontmatter(content: string): { head: string; body: string } {
  const fm = parse(content);
  if (!fm.exists) return { head: '', body: content };
  const lines = content.split('\n');
  return {
    head: lines.slice(0, fm.bodyStart).join('\n'),
    body: lines.slice(fm.bodyStart).join('\n'),
  };
}

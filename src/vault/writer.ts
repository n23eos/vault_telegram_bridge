import { normalizePath, TFile, type Vault } from 'obsidian';
import { errWriteFailed } from '../errors';
import { extractMarkers } from '../sync/dedupe';
import { parentFolderOf } from './daily-note';
import { readSyncedIds, writeSyncedIds } from './frontmatter';

/**
 * Appending under a heading, atomically. TZ §1, SPEC §5б.
 *
 * The write goes through `Vault.process`, a read-modify-write the app serialises
 * for us. Hand-rolling `read()` then `modify()` loses whatever the user typed in
 * between — and this plugin writes on a timer, so "in between" is every thirty
 * seconds of someone's editing session.
 *
 * Deduplication happens *inside* that callback, against the content Obsidian
 * just handed us, rather than against a copy read earlier. Between a read and a
 * write, the phone's copy of this note can arrive over vault sync carrying the
 * same messages. Filtering against stale content is how duplicates appear.
 *
 * `applyEntries` is pure and holds everything worth arguing about.
 */

export interface NoteEntry {
  /** `<chatId>:<messageId>`. Recorded in frontmatter once written. */
  key: string;
  lines: string[];
}

/* ------------------------------------------------------------------ */
/* Pure                                                                */
/* ------------------------------------------------------------------ */

function headingLevel(heading: string): number {
  const m = /^(#{1,6})\s/.exec(heading.trim());
  return m ? m[1].length : 2;
}

/** Index of the line after the closing `---`, or 0 when there is no frontmatter. */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i + 1;
  return 0;
}

/**
 * Where the section under `heading` ends: the next heading of the same level or
 * shallower, or end of file.
 *
 * Fenced code blocks are tracked. This matters more now than it used to: in
 * `code` block style every entry we write *is* a fence, and a message someone
 * pasted from a shell script would otherwise truncate the section at `# comment`.
 */
interface Fence {
  char: string;
  length: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * A fence is closed only by the same character, at least as long. This is not
 * pedantry: `renderEntry` in `code` style deliberately opens a ```` ```` ````
 * fence around a message that itself contains ``` ``` ```, and a naive
 * first-match-wins scanner would close it on the message's own backticks and
 * then treat the rest of the note as prose.
 */
function fenceAt(line: string): Fence | null {
  const m = FENCE.exec(line);
  return m ? { char: m[1][0], length: m[1].length } : null;
}

function closes(fence: Fence, line: string): boolean {
  const f = fenceAt(line);
  return f !== null && f.char === fence.char && f.length >= fence.length;
}

/**
 * Where the section under `heading` ends: the next heading of the same level or
 * shallower, or end of file.
 *
 * Fenced code blocks are tracked. This matters more now than it used to: in
 * `code` block style every entry we write *is* a fence, and a message someone
 * pasted from a shell script would otherwise truncate the section at `# comment`.
 */
function sectionEnd(lines: string[], startAfter: number, level: number): number {
  const boundary = new RegExp(`^#{1,${level}}\\s`);
  let fence: Fence | null = null;

  for (let i = startAfter; i < lines.length; i++) {
    const line = lines[i];
    if (fence === null) {
      const open = fenceAt(line);
      if (open) fence = open;
      else if (boundary.test(line)) return i;
    } else if (closes(fence, line)) {
      fence = null;
    }
  }
  return lines.length;
}

/** Index of the heading line, or -1. Frontmatter and code fences are skipped. */
function findHeading(lines: string[], heading: string): number {
  const needle = heading.trim();
  let fence: Fence | null = null;

  for (let i = bodyStart(lines); i < lines.length; i++) {
    const line = lines[i];
    if (fence === null) {
      const open = fenceAt(line);
      if (open) fence = open;
      else if (line.trim() === needle) return i;
    } else if (closes(fence, line)) {
      fence = null;
    }
  }
  return -1;
}

/**
 * Returns `content` with `lines` appended at the end of `heading`'s section,
 * creating the heading at the end of the note if it is absent.
 *
 * A blank line separates the new lines from whatever was already in the section.
 * Without bullets, two adjacent lines are one paragraph, so the blank line is
 * load-bearing, not cosmetic.
 */
export function insertUnderHeading(content: string, heading: string, lines: string[]): string {
  if (lines.length === 0) return content;

  const trimmedHeading = heading.trim();
  const body = content.split('\n');
  const at = findHeading(body, trimmedHeading);

  if (at === -1) {
    const out = [...body];
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    if (out.length > 0) out.push('');
    out.push(trimmedHeading, '', ...lines, '');
    return out.join('\n');
  }

  const end = sectionEnd(body, at + 1, headingLevel(trimmedHeading));

  // Peel off the section's trailing blank lines, insert, put them back. This is
  // what stops blank lines accumulating on every sync.
  let insertAt = end;
  while (insertAt > at + 1 && body[insertAt - 1].trim() === '') insertAt--;

  const sectionHasContent = insertAt > at + 1;
  const separated = sectionHasContent ? ['', ...lines] : [...lines];

  const out = [...body.slice(0, insertAt), ...separated, ...body.slice(insertAt)];
  if (out[out.length - 1] !== '') out.push('');
  return out.join('\n');
}

export interface ApplyResult {
  content: string;
  written: number;
}

/**
 * The whole note transformation: filter what is already recorded, append the
 * rest under the heading, and record their ids in frontmatter.
 *
 * Reads both the frontmatter `tg_ids` and the legacy inline `%%tg:…%%` markers,
 * so a note written by an earlier version is recognised and never re-synced.
 * Only frontmatter is written; the old markers are left where they are rather
 * than rewriting the user's body to satisfy our bookkeeping.
 *
 * `ensureTag` is true when this write created the note — the `tg-bridge` tag
 * must land even when a seed template brought frontmatter of its own.
 */
export function applyEntries(
  content: string,
  heading: string,
  entries: NoteEntry[],
  ensureTag = false,
): ApplyResult {
  const recorded = readSyncedIds(content);
  const seen = new Set([...recorded, ...extractMarkers(content)]);

  const fresh: NoteEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.key)) continue;
    seen.add(e.key); // guards a duplicate inside this very batch
    fresh.push(e);
  }
  if (fresh.length === 0) return { content, written: 0 };

  const withBody = insertUnderHeading(content, heading, flatten(fresh));
  const ids = [...recorded, ...fresh.map((e) => e.key)];
  return { content: writeSyncedIds(withBody, ids, ensureTag), written: fresh.length };
}

/** Entries, separated by one blank line. */
function flatten(entries: NoteEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (out.length > 0) out.push('');
    out.push(...e.lines);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Vault-facing                                                        */
/* ------------------------------------------------------------------ */

export interface NoteWriter {
  /**
   * Returns how many entries were actually written. Duplicates are silently
   * dropped. `seed` is the initial content — a rendered daily-note template —
   * used only when the note does not exist yet.
   */
  appendEntries(notePath: string, heading: string, entries: NoteEntry[], seed?: string): Promise<number>;

  /**
   * Message keys already recorded in the note, as of now. A best-effort
   * pre-check so the engine can skip paid work (transcription) for entries the
   * final in-write dedup would drop anyway; it is never the dedup itself.
   */
  recordedKeys?(notePath: string): Promise<Set<string>>;
}

export class VaultNoteWriter implements NoteWriter {
  constructor(private readonly vault: Vault) {}

  async recordedKeys(notePath: string): Promise<Set<string>> {
    const file = this.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) return new Set();
    try {
      const content = await this.vault.cachedRead(file);
      // Same two sources the in-write dedup consults: frontmatter + legacy markers.
      const keys = readSyncedIds(content);
      for (const key of extractMarkers(content)) keys.add(key);
      return keys;
    } catch {
      // Unreadable now — the in-write dedup still protects the note.
      return new Set();
    }
  }

  async appendEntries(notePath: string, heading: string, entries: NoteEntry[], seed = ''): Promise<number> {
    if (entries.length === 0) return 0;
    const path = normalizePath(notePath);

    try {
      const { file, created } = await this.ensureNote(path, seed);
      let written = 0;
      await this.vault.process(file, (data) => {
        const result = applyEntries(data, heading, entries, created);
        written = result.written;
        return result.content;
      });
      return written;
    } catch (e) {
      throw errWriteFailed(path, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Creates the note with `seed` (the rendered daily-note template, or `''`).
   * The frontmatter, tag and heading are still added by `applyEntries` inside
   * `Vault.process`, so there is exactly one place that decides what an entry
   * looks like — the seed only decides what the rest of a fresh note holds.
   */
  private async ensureNote(path: string, seed: string): Promise<{ file: TFile; created: boolean }> {
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return { file: existing, created: false };

    await this.ensureFolder(parentFolderOf(path));

    try {
      return { file: await this.vault.create(path, seed), created: true };
    } catch (e) {
      // Another device's sync, or our own previous tick, created it in the gap
      // between the lookup and the create. That is a success, not a failure.
      const raced = this.vault.getAbstractFileByPath(path);
      if (raced instanceof TFile) return { file: raced, created: false };
      throw e;
    }
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (folder === '') return;
    if (this.vault.getAbstractFileByPath(folder)) return;
    try {
      await this.vault.createFolder(folder);
    } catch {
      if (!this.vault.getAbstractFileByPath(folder)) throw new Error(`cannot create folder ${folder}`);
    }
  }
}

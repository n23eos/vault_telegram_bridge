/**
 * Reading the legacy inline markers.
 *
 * Up to and including the first builds, every line carried a `%%tg:chat:id%%`
 * comment and deduplication read it back out of the body. Records now live in
 * the note's frontmatter (`vault/frontmatter.ts`) — see that file for why.
 *
 * This module survives for exactly one reason: a note written by the old version
 * must not be re-synced. `extractMarkers` still recognises both historical
 * formats. Nothing writes them any more.
 *
 * Delete this file once no vault in the wild predates the frontmatter format.
 */

import type { MsgRef } from '../telegram/types';

export type { MsgRef };

/** `%%tg:<chatId>:<messageId>%%` — chatId may be negative (channels). */
const OBSIDIAN_MARKER_RE = /%%tg:(-?\d+):(\d+)%%/g;

/** `<!-- tg:<chatId>:<messageId> -->`, with flexible inner whitespace. */
const HTML_MARKER_RE = /<!--\s*tg:(-?\d+):(\d+)\s*-->/g;

/** The canonical identity of a message, and the key used in `tg_ids`. */
export function markerKey(ref: MsgRef): string {
  return `${ref.chatId}:${ref.messageId}`;
}

/**
 * Every legacy marker in the note, in canonical `<chatId>:<messageId>` form.
 *
 * Both historical formats are recognised regardless of which one was written, so
 * a format change never resurrects already-synced messages.
 */
export function extractMarkers(noteContent: string): Set<string> {
  const found = new Set<string>();
  for (const re of [OBSIDIAN_MARKER_RE, HTML_MARKER_RE]) {
    // Module-level `RegExp` objects with `/g` carry `lastIndex` between calls.
    // Resetting it is the difference between this function being stateless and
    // returning different answers on alternate invocations.
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noteContent)) !== null) found.add(`${m[1]}:${m[2]}`);
  }
  return found;
}

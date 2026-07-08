/**
 * Spike 0.2 fixture. Every placement worth testing, one note.
 *
 * Open this note in: Reading View, Live Preview, Source mode. Then export to
 * PDF. Record what you see against the checklist in docs/MANUAL-TEST-GUIDE.md.
 */
export const DEDUPE_TEST_NOTE = `---
tags: [spike, throwaway]
---

# Dedupe marker render test

Delete this note when the spike is done.

## A — Obsidian comment, inline, end of list item

- 09:12 plain text message %%tg:777000:1%%
- 09:13 message with **bold** and a [[wikilink]] %%tg:777000:2%%
- 09:14 message with a #tag and a https://example.com link %%tg:777000:3%%
- [ ] 09:15 an unchecked task %%tg:777000:4%%
- [x] 09:16 a checked task %%tg:777000:5%%
- 09:17 negative chat id (channel) %%tg:-1001234567890:6%%

## B — Obsidian comment on its own line inside a list

- 09:20 first line of the item
%%tg:777000:7%%
- 09:21 next item

> Expect: the standalone %% line breaks the list into two lists, or renders as
> a paragraph gap. If it does, placement B is rejected.

## C — HTML comment, inline, end of list item

- 09:30 plain text message <!-- tg:777000:8 -->
- [ ] 09:31 an unchecked task <!-- tg:777000:9 -->

## D — Multi-line message, one marker, indented continuation

- 09:40 first line of a multi-line message %%tg:777000:10%%
  second line, indented two spaces
  third line

## E — Hostile bodies (must not swallow the marker)

The sanitizer replaces the inner delimiter with a zero-width space.

- 09:50 body containing a literal double percent: 100%​% off %%tg:777000:11%%
- 09:51 body containing an arrow: a --​> b %%tg:777000:12%%
- 09:52 body opening a comment: <!​-- oops %%tg:777000:13%%

> Expect: all three lines show their full text AND the sync engine still finds
> markers 11, 12, 13. If any line goes blank from mid-sentence, sanitising is
> insufficient and the marker format must change.

## F — Unsanitised control (this SHOULD break — proves the sanitizer matters)

- 09:55 unsanitised %% double percent %%tg:777000:14%%

> Expect: text after the first %% disappears in Reading View and marker 14 is
> hidden inside a comment. This is the failure the sanitizer prevents.

## G — Marker under an existing heading with prior content

Some text the user wrote by hand.

- 10:00 appended by the plugin %%tg:777000:15%%
`;

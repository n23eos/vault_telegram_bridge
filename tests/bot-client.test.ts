import { describe, expect, it } from 'vitest';
import { parseUpdates } from '../src/telegram/bot-client';

const msg = (updateId: number, chatId: number, messageId: number, text?: string, date = 1_700_000_000) => ({
  update_id: updateId,
  message: { message_id: messageId, date, chat: { id: chatId }, ...(text === undefined ? {} : { text }) },
});

describe('parseUpdates — binding', () => {
  it('binds to the first chat that speaks', () => {
    const r = parseUpdates([msg(1, 555, 10, 'hi')], null);
    expect(r.newBinding).toBe('555');
    expect(r.messages).toHaveLength(1);
  });

  it('does not re-bind once bound', () => {
    const r = parseUpdates([msg(1, 555, 10, 'hi')], '555');
    expect(r.newBinding).toBeUndefined();
  });

  it('binds once, then filters the rest of the same batch', () => {
    const r = parseUpdates([msg(1, 555, 10, 'mine'), msg(2, 999, 11, 'stranger')], null);
    expect(r.newBinding).toBe('555');
    expect(r.messages.map((m) => m.messageId)).toEqual([10]);
    expect(r.skipped.foreignChat).toBe(1);
  });

  it('ignores a stranger entirely when already bound', () => {
    const r = parseUpdates([msg(1, 999, 10, 'stranger')], '555');
    expect(r.messages).toHaveLength(0);
    expect(r.skipped.foreignChat).toBe(1);
  });

  it('handles negative chat ids (groups)', () => {
    const r = parseUpdates([msg(1, -1001234, 10, 'hi')], null);
    expect(r.newBinding).toBe('-1001234');
    expect(r.messages[0].chatId).toBe('-1001234');
  });
});

describe('parseUpdates — cursor', () => {
  it('is undefined for an empty batch, so a good cursor is never clobbered', () => {
    expect(parseUpdates([], '555').cursor).toBeUndefined();
  });

  it('advances past the last update', () => {
    expect(parseUpdates([msg(7, 555, 1, 'a'), msg(8, 555, 2, 'b')], '555').cursor).toBe(9);
  });

  it('advances past messages we ignore — otherwise Telegram redelivers them forever', () => {
    const r = parseUpdates([msg(4, 999, 1, 'stranger')], '555');
    expect(r.messages).toHaveLength(0);
    expect(r.cursor).toBe(5);
  });

  it('advances past non-text messages', () => {
    const r = parseUpdates([msg(4, 555, 1, undefined)], '555');
    expect(r.skipped.nonText).toBe(1);
    expect(r.cursor).toBe(5);
  });

  it('advances past updates with no message at all', () => {
    expect(parseUpdates([{ update_id: 12 }], '555').cursor).toBe(13);
  });
});

describe('parseUpdates — content', () => {
  it('skips a message with no text field', () => {
    const r = parseUpdates([msg(1, 555, 10, undefined)], '555');
    expect(r.skipped.nonText).toBe(1);
    expect(r.messages).toHaveLength(0);
  });

  it('skips a whitespace-only message', () => {
    expect(parseUpdates([msg(1, 555, 10, '   \n ')], '555').skipped.nonText).toBe(1);
  });

  it('keeps text verbatim, including newlines — sanitising happens at render', () => {
    const r = parseUpdates([msg(1, 555, 10, 'a\nb  ')], '555');
    expect(r.messages[0].text).toBe('a\nb  ');
  });

  it('carries the unix date through unchanged', () => {
    expect(parseUpdates([msg(1, 555, 10, 'x', 1_234_567)], '555').messages[0].date).toBe(1_234_567);
  });

  it('survives a malformed update without a chat', () => {
    const bad = { update_id: 1, message: { message_id: 1, date: 1, text: 'x' } } as never;
    const r = parseUpdates([bad], '555');
    expect(r.messages).toHaveLength(0);
    expect(r.cursor).toBe(2);
  });
});

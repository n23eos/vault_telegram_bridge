import { describe, expect, it } from 'vitest';
import { attachmentFileName, embedLine } from '../src/vault/attachments';
import type { InboundMessage } from '../src/telegram/types';

const msg = (attachment: NonNullable<InboundMessage['attachment']>): InboundMessage => ({
  chatId: '555',
  messageId: 42,
  date: 1_700_000_000,
  text: '',
  attachment,
});

describe('attachmentFileName — deterministic, so a crashed pass overwrites instead of duplicating', () => {
  it('names a photo by date and message id', () => {
    const m = msg({ kind: 'photo', fileId: 'f1' });
    expect(attachmentFileName(m, '2026-07-08', '.jpg')).toBe('TG-2026-07-08-42.jpg');
  });

  it('keeps a document’s original name, suffixed for uniqueness', () => {
    const m = msg({ kind: 'document', fileId: 'f1', fileName: 'report v2.pdf' });
    expect(attachmentFileName(m, '2026-07-08', '.pdf')).toBe('report v2 TG-42.pdf');
  });

  it('prefers the original extension over the server path’s', () => {
    const m = msg({ kind: 'document', fileId: 'f1', fileName: 'archive.tar.gz' });
    expect(attachmentFileName(m, '2026-07-08', '.bin')).toBe('archive.tar TG-42.gz');
  });

  it('sanitises characters that break a filename', () => {
    const m = msg({ kind: 'document', fileId: 'f1', fileName: 'a:b*c?.pdf' });
    expect(attachmentFileName(m, '2026-07-08', '.pdf')).toBe('abc TG-42.pdf');
  });

  it('falls back to the generic name when the original is all garbage', () => {
    const m = msg({ kind: 'document', fileId: 'f1', fileName: '???.pdf' });
    expect(attachmentFileName(m, '2026-07-08', '.pdf')).toBe('TG-2026-07-08-42.pdf');
  });

  it('survives a missing extension', () => {
    const m = msg({ kind: 'voice', fileId: 'f1' });
    expect(attachmentFileName(m, '2026-07-08', '')).toBe('TG-2026-07-08-42');
  });
});

describe('embedLine', () => {
  it('embeds by full vault path', () => {
    expect(embedLine('Files/TG-2026-07-08-42.jpg')).toBe('![[Files/TG-2026-07-08-42.jpg]]');
  });
});

import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { errFileTooBig, errOffline, errTelegram, HumanError } from '../src/errors';
import type { InboundMessage } from '../src/telegram/types';
import { VaultAttachmentStore } from '../src/vault/attachments';

/**
 * The store against a stub App. The interesting behaviour is the error policy
 * (placeholder vs rethrow) and the download-avoidance paths — exactly what the
 * review flagged.
 */

const fmt = (template: string, date: Date): string =>
  template
    .replace(/YYYY/g, String(date.getUTCFullYear()))
    .replace(/MM/g, String(date.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/DD/g, String(date.getUTCDate()).padStart(2, '0'));

const T = Date.UTC(2026, 6, 8, 9, 12) / 1000;

const photo = (
  over: Partial<NonNullable<InboundMessage['attachment']>> = {},
  messageOver: Partial<InboundMessage> = {},
): InboundMessage => ({
  chatId: '555',
  messageId: 42,
  date: T,
  text: '',
  ...messageOver,
  attachment: { kind: 'photo', fileId: 'f1', ...over },
});

class FakeFile extends TFile {
  constructor(
    public path: string,
    public name: string,
  ) {
    super();
  }
}

function build(opts: {
  files?: Array<{ path: string; name: string }>;
  resolve?: (fileId: string) => Promise<{ filePath: string; ext: string }>;
  fetch?: (filePath: string) => Promise<ArrayBuffer>;
  attachmentFolder?: string;
}) {
  const files = new Map<string, FakeFile>();
  for (const f of opts.files ?? []) files.set(f.path, new FakeFile(f.path, f.name));
  const created: string[] = [];
  const written = new Map<string, ArrayBuffer>();
  const folder = opts.attachmentFolder ?? 'Files';

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      createBinary: async (p: string, data: ArrayBuffer) => {
        created.push(p);
        written.set(p, data);
        const f = new FakeFile(p, p.split('/').pop() ?? p);
        files.set(p, f);
        return f;
      },
      createFolder: async (p: string) => {
        files.set(p, new FakeFile(p, p));
      },
    },
    fileManager: {
      getAvailablePathForAttachment: async (name: string) => `${folder}/${name}`,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string, _sourcePath: string) =>
        [...files.values()].find((f) => f.name === linkpath) ?? null,
    },
  } as unknown as App;

  const calls = { resolve: 0, fetch: 0 };
  const store = new VaultAttachmentStore({
    app,
    resolve: async (fileId) => {
      calls.resolve++;
      return opts.resolve ? opts.resolve(fileId) : { filePath: 'photos/file_1.jpg', ext: '.jpg' };
    },
    fetch: async (filePath) => {
      calls.fetch++;
      return opts.fetch ? opts.fetch(filePath) : new ArrayBuffer(8);
    },
    format: fmt,
  });
  return { store, created, written, calls };
}

describe('VaultAttachmentStore — success', () => {
  it('downloads, stores, and returns the embed line', async () => {
    const { store, created } = build({});
    const line = await store.save(photo(), '2026-07-08.md');
    expect(created).toEqual(['Files/TG-2026-07-08-555-42.jpg']);
    expect(line).toMatchObject({ line: '![[Files/TG-2026-07-08-555-42.jpg]]' });
  });
});

describe('VaultAttachmentStore — error policy (review fix: no sync wedge)', () => {
  it('turns a known-oversize attachment into a placeholder without any network call', async () => {
    const { store, calls } = build({});
    const line = await store.save(photo({ fileSize: 21 * 1024 * 1024 }), 'n.md');
    expect(line.line).toContain('20 MB');
    expect(calls.resolve + calls.fetch).toBe(0);
  });

  it('turns a server-side "file too big" into the same placeholder', async () => {
    const { store } = build({
      resolve: async () => {
        throw errFileTooBig();
      },
    });
    expect((await store.save(photo(), 'n.md')).line).toContain('20 MB');
  });

  it('turns a permanent failure into a placeholder instead of wedging sync', async () => {
    const { store } = build({
      resolve: async () => {
        throw errTelegram('Bad Request: wrong file identifier');
      },
    });
    const line = await store.save(photo(), 'n.md');
    expect(line.line).toContain('could not be downloaded');
  });

  it('rethrows a retryable failure so the pass retries', async () => {
    const { store } = build({
      fetch: async () => {
        throw errOffline();
      },
    });
    await expect(store.save(photo(), 'n.md')).rejects.toSatisfy(
      (e) => e instanceof HumanError && e.key === 'error.offline',
    );
  });
});

describe('VaultAttachmentStore — download avoidance (review fix)', () => {
  it('skips resolve and fetch entirely when a file with the deterministic name already exists anywhere', async () => {
    const { store, calls, created } = build({
      files: [{ path: 'Old/TG-2026-07-08-555-42.jpg', name: 'TG-2026-07-08-555-42.jpg' }],
      resolve: async () => ({ filePath: 'photos/file_1.jpg', ext: '.jpg' }),
    });
    // The name needs the ext, and the ext comes from resolve for a photo — so
    // resolve is allowed; the byte fetch is what must not happen.
    const line = await store.save(photo(), 'n.md');
    expect(calls.fetch).toBe(0);
    expect(created).toEqual([]);
    expect(line.line).toBe('![[Old/TG-2026-07-08-555-42.jpg]]');
  });

  it('needs no resolve call at all when the original name carries the extension', async () => {
    const { store, calls } = build({
      files: [{ path: 'Files/report TG-555-42.pdf', name: 'report TG-555-42.pdf' }],
    });
    const m = photo({ kind: 'document', fileName: 'report.pdf' });
    const line = await store.save(m, 'n.md');
    expect(calls.resolve).toBe(0);
    expect(calls.fetch).toBe(0);
    expect(line.line).toBe('![[Files/report TG-555-42.pdf]]');
  });

  it('stores separate bytes for matching attachment metadata from different chats', async () => {
    const { store, calls, created, written } = build({
      resolve: async (fileId) => ({ filePath: `${fileId}.pdf`, ext: '.pdf' }),
      fetch: async (filePath) => new TextEncoder().encode(filePath).buffer,
    });
    const attachment = { kind: 'document' as const, fileName: 'report.pdf', fileId: 'chat-555' };

    await store.save(photo(attachment, { chatId: '555' }), 'n.md');
    await store.save(photo({ ...attachment, fileId: 'chat-999' }, { chatId: '999' }), 'n.md');

    expect(calls.fetch).toBe(2);
    expect(created).toEqual(['Files/report TG-555-42.pdf', 'Files/report TG-999-42.pdf']);
    expect(new TextDecoder().decode(written.get('Files/report TG-555-42.pdf')!)).toBe('chat-555.pdf');
    expect(new TextDecoder().decode(written.get('Files/report TG-999-42.pdf')!)).toBe('chat-999.pdf');
  });

  it('does not claim an unqualified legacy file for a new chat-scoped import', async () => {
    const { store, calls, created } = build({
      files: [{ path: 'Old/report TG-42.pdf', name: 'report TG-42.pdf' }],
    });

    const saved = await store.save(photo({ kind: 'document', fileName: 'report.pdf' }), 'n.md');

    expect(calls.fetch).toBe(1);
    expect(created).toEqual(['Files/report TG-555-42.pdf']);
    expect(saved.line).toBe('![[Files/report TG-555-42.pdf]]');
  });

  it('returns downloaded bytes and file name when requested for transcription', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const { store } = build({ fetch: async () => bytes });
    const saved = await store.save(photo({ kind: 'voice' }), 'n.md', true);
    expect(saved.data).toBe(bytes);
    expect(saved.fileName).toBe('TG-2026-07-08-555-42.jpg');
  });
});

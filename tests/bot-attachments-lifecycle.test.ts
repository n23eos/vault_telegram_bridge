import { requestUrl, TFile, type App, type RequestUrlResponse } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { SyncEngine } from '../src/sync/engine';
import { BotClient } from '../src/telegram/bot-client';
import { VaultAttachmentStore } from '../src/vault/attachments';
import { applyEntries, type NoteEntry } from '../src/vault/writer';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  requestUrl: vi.fn(),
}));

const request = vi.mocked(requestUrl);
const token = `12345:${'x'.repeat(30)}`;
const newToken = `67890:${'y'.repeat(30)}`;
const bytes = new Uint8Array([1, 2, 3]).buffer;
const wire = (status: number, json: unknown, arrayBuffer = new ArrayBuffer(0)): RequestUrlResponse => ({
  status, headers: {}, json, text: JSON.stringify(json), arrayBuffer,
});
const response = (result: unknown) => wire(200, { ok: true, result });
const file = () => response({ file_id: 'f1', file_path: 'photos/file.jpg' });
const download = () => wire(200, {}, bytes);
const updates = () => response([{
  update_id: 7,
  message: {
    message_id: 42, date: 1_700_000_000, chat: { id: 555 },
    photo: [{ file_id: 'f1', width: 100, height: 100 }],
  },
}]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function build() {
  const settings: Settings = { ...DEFAULT_SETTINGS, botToken: token, cursor: 7 };
  const client = new BotClient({ getToken: () => settings.botToken, getBoundChatId: () => '555', onBind: vi.fn() });
  const binaries = new Map<string, ArrayBuffer>();
  const files = new Map<string, TFile>();
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      createBinary: async (path: string, data: ArrayBuffer) => {
        binaries.set(path, data);
        const file = Object.assign(new TFile(), { path, name: path });
        files.set(path, file);
        return file;
      },
    },
    fileManager: { getAvailablePathForAttachment: async (name: string) => name },
    metadataCache: { getFirstLinkpathDest: () => null },
  } as unknown as App;
  const attachments = new VaultAttachmentStore({
    app, resolve: (id) => client.resolveFile(id), fetch: (path) => client.fetchFile(path),
    format: () => '2026-07-08',
  });
  const notes = new Map<string, string>();
  const onNotice = vi.fn();
  const engine = new SyncEngine({
    source: client,
    writer: {
      appendEntries: async (path: string, heading: string, entries: NoteEntry[]) => {
        const result = applyEntries(notes.get(path) ?? '', heading, entries);
        notes.set(path, result.content);
        return result.written;
      },
    },
    settings: () => settings,
    persist: async (patch) => { Object.assign(settings, patch); },
    format: () => '2026-07-08',
    onNotice,
    attachments,
    transcriber: { transcribe: async () => '' },
    seed: async () => '',
  });
  return { client, engine, settings, notes, binaries, onNotice };
}

beforeEach(() => {
  request.mockReset();
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_001));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Bot attachments across reconnect', () => {
  it.each([
    { stage: 'getFile', status: 200 },
    { stage: 'getFile', status: 404 },
    { stage: 'download', status: 200 },
    { stage: 'download', status: 404 },
  ])('retries the batch after a stale $stage HTTP $status without writing a placeholder', async ({ stage, status }) => {
    const pending = deferred<RequestUrlResponse>();
    const started = deferred<void>();
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockResolvedValueOnce(updates());
    if (stage === 'download') request.mockResolvedValueOnce(file());
    request.mockImplementationOnce(() => {
      started.resolve();
      return pending.promise as never;
    }).mockResolvedValueOnce(response({ username: 'new_bot' }));
    const { client, engine, settings, notes, binaries, onNotice } = build();

    await client.connect();
    const run = engine.run('manual');
    await started.promise;
    await client.disconnect();
    settings.botToken = newToken;
    await client.connect();
    pending.resolve(status === 200
      ? stage === 'getFile' ? file() : download()
      : wire(status, { ok: false, description: 'Not found' }));

    expect(await run).toBeNull();
    expect(settings.cursor).toBe(7);
    expect(settings.lastSync).toBeNull();
    expect([...notes]).toEqual([]);
    expect([...binaries]).toEqual([]);
    expect(onNotice).not.toHaveBeenCalled();

    request.mockResolvedValueOnce(updates()).mockResolvedValueOnce(file()).mockResolvedValueOnce(download());
    expect(await engine.run('manual')).toMatchObject({ written: 1 });
    expect(settings.cursor).toBe(8);
    expect(notes.get('2026-07-08.md')).toContain('![[TG-2026-07-08-555-42.jpg]]');
    expect([...binaries]).toEqual([['TG-2026-07-08-555-42.jpg', bytes]]);
    expect(request.mock.calls.filter(([arg]) => typeof arg !== 'string' && arg.url.endsWith('/getUpdates'))).toEqual([
      [{ url: `https://api.telegram.org/bot${token}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":7,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
      [{ url: `https://api.telegram.org/bot${newToken}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":7,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
    ]);
  });

  it.each([
    { status: 429, wait: 2_000 },
    { status: 409, wait: 5_000 },
  ])('cancels a $status download retry without borrowing the new token or acknowledging the batch', async ({ status, wait }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('window', globalThis);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockResolvedValueOnce(updates())
      .mockResolvedValueOnce(file())
      .mockResolvedValueOnce(wire(status, { ok: false, parameters: { retry_after: 2 } }))
      .mockResolvedValueOnce(response({ username: 'new_bot' }))
      .mockResolvedValue(download());
    const { client, engine, settings, notes, binaries, onNotice } = build();

    await client.connect();
    const run = engine.run('manual');
    await vi.advanceTimersByTimeAsync(0);
    await client.disconnect();
    settings.botToken = newToken;
    await client.connect();
    await vi.advanceTimersByTimeAsync(wait);

    expect(await run).toBeNull();
    expect(settings.cursor).toBe(7);
    expect(settings.lastSync).toBeNull();
    expect([...notes]).toEqual([]);
    expect([...binaries]).toEqual([]);
    expect(onNotice).not.toHaveBeenCalled();
    expect(request.mock.calls.filter(([arg]) => typeof arg !== 'string' && arg.url.includes('/file/'))).toEqual([
      [{ url: `https://api.telegram.org/file/bot${token}/photos/file.jpg`, throw: false }],
    ]);

    request.mockResolvedValueOnce(updates()).mockResolvedValueOnce(file()).mockResolvedValueOnce(download());
    expect(await engine.run('manual')).toMatchObject({ written: 1 });
    expect(settings.cursor).toBe(8);
    expect(notes.get('2026-07-08.md')).toContain('![[TG-2026-07-08-555-42.jpg]]');
  });
});

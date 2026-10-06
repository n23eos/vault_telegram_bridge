import { requestUrl, type RequestUrlResponse } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotClient, parseUpdates } from '../src/telegram/bot-client';

vi.mock('obsidian', () => ({
  getLanguage: () => 'en',
  requestUrl: vi.fn(),
}));

const request = vi.mocked(requestUrl);
const token = `12345:${'x'.repeat(30)}`;
const newToken = `67890:${'y'.repeat(30)}`;

const wireResponse = (status: number, json: unknown): RequestUrlResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  json,
  text: JSON.stringify(json),
  arrayBuffer: new ArrayBuffer(0),
});

const response = (result: unknown) => wireResponse(200, { ok: true, result });

const failure = (status: number) => wireResponse(status, {
  ok: false,
  description: 'Request failed',
  ...(status === 429 ? { parameters: { retry_after: 2 } } : {}),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function useRetryTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('window', globalThis);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
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

const msg = (updateId: number, chatId: number, messageId: number, text?: string, date = 1_700_000_000) => ({
  update_id: updateId,
  message: { message_id: messageId, date, chat: { id: chatId }, ...(text === undefined ? {} : { text }) },
});

describe('BotClient lifecycle', () => {
  it('polls messages after disconnect and a successful reconnect', async () => {
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockResolvedValueOnce(response([msg(7, 555, 42, 'back online')]));
    const client = new BotClient({
      getToken: () => token,
      getBoundChatId: () => '555',
      onBind: vi.fn(),
    });

    await client.disconnect();
    await client.connect();
    const result = await client.poll(undefined);

    expect(result.messages.map((message) => message.messageId)).toEqual([42]);
  });

  it('discards an in-flight poll from before disconnect and reconnect', async () => {
    let releasePoll!: (value: ReturnType<typeof response>) => void;
    const inFlightPoll = new Promise<ReturnType<typeof response>>((resolve) => {
      releasePoll = resolve;
    });
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockReturnValueOnce(inFlightPoll as never)
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }));
    const onBind = vi.fn();
    const client = new BotClient({
      getToken: () => token,
      getBoundChatId: () => null,
      onBind,
    });

    await client.connect();
    const stalePoll = client.poll(undefined);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await client.disconnect();
    await client.connect();
    releasePoll(response([msg(7, 555, 42, 'stale')]));

    await expect(stalePoll).resolves.toMatchObject({ messages: [], cursor: undefined });
    expect(onBind).not.toHaveBeenCalled();
  });

  it.each([
    { error: 'network', reconnect: false },
    { error: 'network', reconnect: true },
    { error: 401, reconnect: false },
    { error: 401, reconnect: true },
    { error: 500, reconnect: true },
  ])('discards a stale $error failure after disconnect, reconnect=$reconnect', async ({ error, reconnect }) => {
    const pending = deferred<RequestUrlResponse>();
    const started = deferred<void>();
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockImplementationOnce(() => {
        started.resolve();
        return pending.promise as never;
      })
      .mockResolvedValueOnce(response({ username: 'new_bot' }));
    let currentToken = token;
    const onBind = vi.fn();
    const client = new BotClient({ getToken: () => currentToken, getBoundChatId: () => null, onBind });

    await client.connect();
    const stalePoll = client.poll(700);
    await started.promise;
    await client.disconnect();
    if (reconnect) {
      currentToken = newToken;
      await client.connect();
    }
    if (typeof error === 'number') pending.resolve(failure(error));
    else pending.reject(new Error('Transport dropped'));

    await expect(stalePoll).resolves.toEqual({
      messages: [], cursor: undefined, skipped: { nonText: 0, foreignChat: 0 },
    });
    expect(client.status()).toBe(reconnect ? 'connected' : 'disconnected');
    expect(onBind).not.toHaveBeenCalled();
  });

  it.each([
    { error: 'network', key: 'error.network' },
    { error: 401, key: 'error.invalidToken' },
    { error: 500, key: 'error.telegram' },
  ])('preserves an active $error failure', async ({ error, key }) => {
    request.mockResolvedValueOnce(response({ username: 'bridge_bot' }));
    if (typeof error === 'number') request.mockResolvedValueOnce(failure(error));
    else request.mockRejectedValueOnce(new Error('Transport dropped'));
    const client = new BotClient({ getToken: () => token, getBoundChatId: () => '555', onBind: vi.fn() });

    await client.connect();
    await expect(client.poll(700)).rejects.toMatchObject({ key });
  });

  it.each([
    { status: 429, wait: 2_000 },
    { status: 409, wait: 5_000 },
  ])('does not retry an old $status poll with the reconnected token', async ({ status, wait }) => {
    useRetryTimers();
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockResolvedValueOnce(failure(status))
      .mockResolvedValueOnce(response({ username: 'new_bot' }))
      .mockResolvedValue(response([msg(80, 555, 42, 'current')]));
    let currentToken = token;
    const client = new BotClient({ getToken: () => currentToken, getBoundChatId: () => '555', onBind: vi.fn() });

    await client.connect();
    const stalePoll = client.poll(700);
    await vi.advanceTimersByTimeAsync(0);
    await client.disconnect();
    currentToken = newToken;
    await client.connect();
    await vi.advanceTimersByTimeAsync(wait);

    await expect(stalePoll).resolves.toEqual({
      messages: [], cursor: undefined, skipped: { nonText: 0, foreignChat: 0 },
    });
    const result = await client.poll(80);
    expect(result.cursor).toBe(81);
    expect(result.messages.map((message) => message.text)).toEqual(['current']);
    expect(request.mock.calls).toEqual([
      [{ url: `https://api.telegram.org/bot${token}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
      [{ url: `https://api.telegram.org/bot${token}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":700,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
      [{ url: `https://api.telegram.org/bot${newToken}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
      [{ url: `https://api.telegram.org/bot${newToken}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":80,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
    ]);
  });

  it.each([
    { status: 429, wait: 2_000 },
    { status: 409, wait: 5_000 },
  ])('keeps active $status retries and their original cursor', async ({ status, wait }) => {
    useRetryTimers();
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockResolvedValueOnce(failure(status))
      .mockResolvedValueOnce(response([msg(700, 555, 42, 'retried')]));
    const client = new BotClient({ getToken: () => token, getBoundChatId: () => '555', onBind: vi.fn() });

    await client.connect();
    const poll = client.poll(700);
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(request.mock.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);

    const result = await poll;
    expect(result.cursor).toBe(701);
    expect(result.messages.map((message) => message.text)).toEqual(['retried']);
    expect(request.mock.calls.slice(1)).toEqual([
      [{ url: `https://api.telegram.org/bot${token}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":700,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
      [{ url: `https://api.telegram.org/bot${token}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":700,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
    ]);
  });

  it('ignores a late rate limit without notifying or retrying in the new lifecycle', async () => {
    useRetryTimers();
    const pending = deferred<RequestUrlResponse>();
    request
      .mockResolvedValueOnce(response({ username: 'bridge_bot' }))
      .mockReturnValueOnce(pending.promise as never)
      .mockResolvedValueOnce(response({ username: 'new_bot' }))
      .mockResolvedValue(response([]));
    let currentToken = token;
    const onLongWait = vi.fn();
    const client = new BotClient({ getToken: () => currentToken, getBoundChatId: () => '555', onBind: vi.fn(), onLongWait });

    await client.connect();
    const stalePoll = client.poll(700);
    await vi.advanceTimersByTimeAsync(0);
    await client.disconnect();
    currentToken = newToken;
    await client.connect();
    pending.resolve(wireResponse(429, { ok: false, parameters: { retry_after: 61 } }));
    await vi.advanceTimersByTimeAsync(61_000);

    await expect(stalePoll).resolves.toEqual({
      messages: [], cursor: undefined, skipped: { nonText: 0, foreignChat: 0 },
    });
    expect(onLongWait).not.toHaveBeenCalled();
    expect(request.mock.calls).toEqual([
      [{ url: `https://api.telegram.org/bot${token}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
      [{ url: `https://api.telegram.org/bot${token}/getUpdates`, method: 'POST', contentType: 'application/json', body: '{"offset":700,"limit":100,"timeout":0,"allowed_updates":["message"]}', throw: false }],
      [{ url: `https://api.telegram.org/bot${newToken}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
    ]);
  });

  it('does not send a poll that was waiting at the request gate before reconnect', async () => {
    useRetryTimers();
    vi.mocked(Date.now).mockReturnValue(10_000);
    request.mockResolvedValue(response({ username: 'bridge_bot' }));
    let currentToken = token;
    const client = new BotClient({ getToken: () => currentToken, getBoundChatId: () => '555', onBind: vi.fn() });

    await client.connect();
    const stalePoll = client.poll(700);
    await vi.advanceTimersByTimeAsync(0);
    await client.disconnect();
    currentToken = newToken;
    const reconnect = client.connect();
    await vi.advanceTimersByTimeAsync(1_000);
    await reconnect;

    await expect(stalePoll).resolves.toEqual({
      messages: [], cursor: undefined, skipped: { nonText: 0, foreignChat: 0 },
    });
    expect(request.mock.calls).toEqual([
      [{ url: `https://api.telegram.org/bot${token}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
      [{ url: `https://api.telegram.org/bot${newToken}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
    ]);
  });

  it('does not retry a superseded connection with the new token', async () => {
    useRetryTimers();
    request
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValue(response({ username: 'new_bot' }));
    let currentToken = token;
    const client = new BotClient({ getToken: () => currentToken, getBoundChatId: () => '555', onBind: vi.fn() });

    const oldConnect = client.connect().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    currentToken = newToken;
    await expect(client.connect()).resolves.toEqual({ displayName: 'new_bot' });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await oldConnect).toBeInstanceOf(Error);
    expect(client.status()).toBe('connected');
    expect(request.mock.calls).toEqual([
      [{ url: `https://api.telegram.org/bot${token}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
      [{ url: `https://api.telegram.org/bot${newToken}/getMe`, method: 'POST', contentType: 'application/json', body: '{}', throw: false }],
    ]);
  });
});

describe('BotClient active file downloads', () => {
  it.each([
    { status: 429, wait: 2_000 },
    { status: 409, wait: 5_000 },
  ])('retries an active $status download and returns its bytes', async ({ status, wait }) => {
    useRetryTimers();
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    request.mockResolvedValueOnce(failure(status)).mockResolvedValueOnce({ ...response({}), arrayBuffer: bytes });
    const client = new BotClient({ getToken: () => token, getBoundChatId: () => '555', onBind: vi.fn() });

    const download = client.fetchFile('photos/file.jpg');
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(request.mock.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await download).toEqual(bytes);
    expect(request.mock.calls).toEqual([
      [{ url: `https://api.telegram.org/file/bot${token}/photos/file.jpg`, throw: false }],
      [{ url: `https://api.telegram.org/file/bot${token}/photos/file.jpg`, throw: false }],
    ]);
  });

  it.each([
    { error: 'network', key: 'error.network' },
    { error: 404, key: 'error.telegram' },
  ])('preserves an active download $error failure', async ({ error, key }) => {
    if (typeof error === 'number') request.mockResolvedValueOnce(failure(error));
    else request.mockRejectedValueOnce(new Error('Transport dropped'));
    const client = new BotClient({ getToken: () => token, getBoundChatId: () => '555', onBind: vi.fn() });

    await expect(client.fetchFile('photos/file.jpg')).rejects.toMatchObject({ key });
  });
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

describe('parseUpdates — attachments', () => {
  const media = (updateId: number, messageId: number, fields: Record<string, unknown>) => ({
    update_id: updateId,
    message: { message_id: messageId, date: 1_700_000_000, chat: { id: 555 }, ...fields },
  });

  it('turns a photo with a caption into a message with an attachment', () => {
    const r = parseUpdates(
      [
        media(1, 10, {
          caption: 'sunset',
          photo: [
            { file_id: 'small', file_size: 100, width: 90, height: 60 },
            { file_id: 'big', file_size: 900, width: 900, height: 600 },
          ],
        }),
      ],
      '555',
    );
    expect(r.skipped.nonText).toBe(0);
    expect(r.messages[0].text).toBe('sunset');
    expect(r.messages[0].attachment).toEqual({ kind: 'photo', fileId: 'big', fileSize: 900 });
  });

  it('keeps a captionless photo — the embed is the content', () => {
    const r = parseUpdates([media(1, 10, { photo: [{ file_id: 'p', width: 1, height: 1 }] })], '555');
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].text).toBe('');
  });

  it('carries caption_entities as the message entities', () => {
    const r = parseUpdates(
      [media(1, 10, { caption: 'bold cap', caption_entities: [{ type: 'bold', offset: 0, length: 4 }], photo: [{ file_id: 'p', width: 1, height: 1 }] })],
      '555',
    );
    expect(r.messages[0].entities).toEqual([{ type: 'bold', offset: 0, length: 4 }]);
  });

  it('takes a document’s original file name', () => {
    const r = parseUpdates(
      [media(1, 10, { document: { file_id: 'd', file_name: 'report.pdf', file_size: 5 } })],
      '555',
    );
    expect(r.messages[0].attachment).toEqual({ kind: 'document', fileId: 'd', fileName: 'report.pdf', fileSize: 5 });
  });

  it('classifies an animation as its own kind, not as its legacy document twin', () => {
    const r = parseUpdates(
      [media(1, 10, { animation: { file_id: 'a' }, document: { file_id: 'a-doc' } })],
      '555',
    );
    expect(r.messages[0].attachment?.fileId).toBe('a');
  });

  it('maps voice, audio, video and video_note', () => {
    const kinds = [
      { fields: { voice: { file_id: 'v' } }, kind: 'voice' },
      { fields: { audio: { file_id: 'a' } }, kind: 'audio' },
      { fields: { video: { file_id: 'vd' } }, kind: 'video' },
      { fields: { video_note: { file_id: 'vn' } }, kind: 'video_note' },
    ];
    for (const k of kinds) {
      const r = parseUpdates([media(1, 10, k.fields)], '555');
      expect(r.messages[0].attachment?.kind).toBe(k.kind);
    }
  });

  it('still skips stickers, polls and the like', () => {
    const r = parseUpdates(
      [media(1, 10, { sticker: { file_id: 's' } }), media(2, 11, { poll: { id: 'p' } })],
      '555',
    );
    expect(r.messages).toHaveLength(0);
    expect(r.skipped.nonText).toBe(2);
    expect(r.cursor).toBe(3);
  });

  it('carries text entities on a plain text message', () => {
    const r = parseUpdates(
      [media(1, 10, { text: 'bold text', entities: [{ type: 'bold', offset: 0, length: 4 }] })],
      '555',
    );
    expect(r.messages[0].entities).toEqual([{ type: 'bold', offset: 0, length: 4 }]);
  });
});

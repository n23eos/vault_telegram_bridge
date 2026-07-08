import { requestUrl, type RequestUrlResponse } from 'obsidian';
import {
  errInvalidToken,
  errNetwork,
  errNoToken,
  errOffline,
  errTelegram,
  errTokenShape,
  HumanError,
} from '../errors';
import { looksLikeBotToken } from '../settings';
import { classifyStatus, FloodPolicy, realDeps } from './flood';
import type { InboundMessage, MessageSource, PollResult, SourceIdentity, SourceStatus } from './types';

/**
 * Telegram Bot API client. TZ §1: network goes through `requestUrl`, never
 * `fetch` — `requestUrl` bypasses CORS and works identically on mobile.
 *
 * Short polling, not long polling. `requestUrl` cannot be aborted, so a 25-second
 * long poll would still be in flight when the plugin unloads, and would resolve
 * into a disposed engine. Polling with `timeout=0` on a 30 s interval costs two
 * requests a minute, is trivially cancellable, and matches the `registerInterval`
 * lifecycle TZ §5.4 asks for. Latency is bounded by the interval; that is the
 * trade and it is stated in the README.
 */

const API_BASE = 'https://api.telegram.org';

/** Bot API caps a single getUpdates at 100. */
const PAGE_SIZE = 100;

/** Everything else — edited_message, channel_post, callbacks — is never delivered. */
const ALLOWED_UPDATES = ['message'] as const;

/* ------------------------------------------------------------------ */
/* Wire shapes. Only the fields we read.                               */
/* ------------------------------------------------------------------ */

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number };
  text?: string;
}

interface TgUser {
  username?: string;
  first_name?: string;
}

/* ------------------------------------------------------------------ */
/* Pure parsing — the part worth testing                               */
/* ------------------------------------------------------------------ */

export interface ParsedUpdates {
  messages: InboundMessage[];
  /** `undefined` when the batch was empty: do not move a cursor we did not advance. */
  cursor: number | undefined;
  skipped: { nonText: number; foreignChat: number };
  /** Set when this batch bound a previously unbound bot. */
  newBinding: string | undefined;
}

/**
 * Turns a `getUpdates` result into messages, and decides what to ignore.
 *
 * Two rules do the real work:
 *
 * 1. **The cursor advances past everything, including what we ignore.** An
 *    update we refuse to write but refuse to acknowledge is an update Telegram
 *    hands us again forever. Non-text messages and messages from foreign chats
 *    are counted, dropped, and confirmed.
 *
 * 2. **The first chat to speak binds the bot.** A bot username is guessable and
 *    anyone can message it. Without a binding, a stranger writes into the user's
 *    daily note. See docs/ADR-001-bot-mode-first.md.
 */
export function parseUpdates(updates: TgUpdate[], boundChatId: string | null): ParsedUpdates {
  const messages: InboundMessage[] = [];
  const skipped = { nonText: 0, foreignChat: 0 };
  let cursor: number | undefined;
  let binding = boundChatId;
  let newBinding: string | undefined;

  for (const u of updates) {
    // Advance unconditionally: see rule 1.
    cursor = u.update_id + 1;

    const m = u.message;
    if (!m || typeof m.chat?.id !== 'number') continue;

    const chatId = String(m.chat.id);

    if (binding === null) {
      binding = chatId;
      newBinding = chatId;
    } else if (chatId !== binding) {
      skipped.foreignChat++;
      continue;
    }

    const text = typeof m.text === 'string' ? m.text : '';
    if (text.trim() === '') {
      // Photos, voice notes, documents, stickers, service messages. v0.2 handles
      // these; v0.1 counts them so the user is told rather than left wondering.
      skipped.nonText++;
      continue;
    }

    messages.push({ chatId, messageId: m.message_id, date: m.date, text });
  }

  return { messages, cursor, skipped, newBinding };
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface BotClientOptions {
  getToken: () => string;
  getBoundChatId: () => string | null;
  /** Called when a batch binds the bot for the first time. Persisted by the caller. */
  onBind: (chatId: string) => void;
  onLongWait?: (seconds: number) => void;
}

export class BotClient implements MessageSource {
  private state: SourceStatus = 'disconnected';
  private identity: SourceIdentity | null = null;
  private readonly flood: FloodPolicy;
  private disposed = false;

  constructor(private readonly opts: BotClientOptions) {
    this.flood = new FloodPolicy(realDeps(opts.onLongWait));
  }

  status(): SourceStatus {
    return this.state;
  }

  async connect(): Promise<SourceIdentity> {
    const token = this.opts.getToken();
    if (!token) {
      this.state = 'auth_required';
      throw errNoToken();
    }
    if (!looksLikeBotToken(token)) {
      this.state = 'auth_required';
      throw errTokenShape();
    }

    this.state = 'connecting';
    try {
      const me = await this.call<TgUser>('getMe', {});
      this.identity = { displayName: me.username ?? me.first_name ?? 'bot' };
      this.state = 'connected';
      return this.identity;
    } catch (e) {
      this.state = e instanceof HumanError && e.key === 'error.invalidToken' ? 'auth_required' : 'disconnected';
      throw e;
    }
  }

  async poll(cursor: number | undefined): Promise<PollResult> {
    if (this.disposed) return empty();
    if (!this.opts.getToken()) throw errNoToken();

    const updates = await this.call<TgUpdate[]>('getUpdates', {
      offset: cursor,
      limit: PAGE_SIZE,
      timeout: 0,
      allowed_updates: ALLOWED_UPDATES,
    });

    if (this.disposed) return empty();

    const parsed = parseUpdates(updates, this.opts.getBoundChatId());
    if (parsed.newBinding) this.opts.onBind(parsed.newBinding);
    this.state = 'connected';

    return { messages: parsed.messages, cursor: parsed.cursor, skipped: parsed.skipped };
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.state = 'disconnected';
  }

  async wipe(): Promise<void> {
    // The token lives in settings; the caller clears it. Nothing of ours persists.
    await this.disconnect();
    this.identity = null;
  }

  /* ---------------- transport ---------------- */

  /**
   * One Bot API call, with the rate-limit and conflict policy applied.
   *
   * Retries only what is worth retrying: a 429 after the server's own wait, and
   * a 409 after a backoff. A bad token, a malformed request or a 500 propagate
   * immediately — retrying them just delays the error the user needs to see.
   */
  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const maxAttempts = 3;

    for (let attempt = 1; ; attempt++) {
      if (!navigator.onLine) throw errOffline();
      await this.flood.gate();

      let res: RequestUrlResponse;
      try {
        res = await requestUrl({
          url: `${API_BASE}/bot${this.opts.getToken()}/${method}`,
          method: 'POST',
          contentType: 'application/json',
          body: JSON.stringify(pruneUndefined(params)),
          // Handle status codes ourselves; `throw: true` would discard the body,
          // and the body is where `retry_after` lives.
          throw: false,
        });
      } catch (e) {
        // requestUrl only rejects on transport failure, never on HTTP status.
        throw navigator.onLine ? errNetwork(e) : errOffline();
      }

      const body = safeJson<TgResponse<T>>(res);

      if (res.status === 401 || res.status === 404) throw errInvalidToken();

      const throttle = classifyStatus(res.status, body);
      if (throttle) {
        if (attempt >= maxAttempts) throw throttle;
        if (throttle.key === 'error.rateLimited') {
          await this.flood.waitForRateLimit(Number(throttle.params?.seconds ?? 1));
        } else {
          await this.flood.waitForConflict();
        }
        continue;
      }

      if (res.status >= 400 || !body?.ok) {
        throw errTelegram(body?.description ?? `HTTP ${res.status}`);
      }

      this.flood.succeeded();
      return body.result as T;
    }
  }
}

function empty(): PollResult {
  return { messages: [], cursor: undefined, skipped: { nonText: 0, foreignChat: 0 } };
}

/** Telegram rejects `offset: null`; omit the key instead. */
function pruneUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

function safeJson<T>(res: RequestUrlResponse): T | undefined {
  try {
    return res.json as T;
  } catch {
    return undefined;
  }
}

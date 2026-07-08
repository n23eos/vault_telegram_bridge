import { HumanError, isRetryable, toHumanError } from '../errors';
import type { InboundMessage, MessageSource } from '../telegram/types';
import type { Settings } from '../settings';
import { resolveDailyNotePath, type DateFormatter } from '../vault/daily-note';
import type { NoteEntry, NoteWriter } from '../vault/writer';
import { markerKey } from './dedupe';
import { renderEntry } from './render';

/**
 * Orchestration. TZ §5.4. The only module that knows about both a `MessageSource`
 * and a `NoteWriter`; neither knows about the other.
 */

export interface SyncResult {
  written: number;
  skipped: { nonText: number; foreignChat: number; duplicate: number };
}

export interface EngineDeps {
  source: MessageSource;
  writer: NoteWriter;
  settings: () => Settings;
  /** Persist cursor and lastSync. Called at most once per run. */
  persist: (patch: Partial<Settings>) => Promise<void>;
  format: DateFormatter;
  onNotice: (e: HumanError) => void;
}

export class SyncEngine {
  /** Reentrancy guard. A 30 s timer and a "Sync now" click will collide. */
  private running = false;
  private lastError: HumanError | null = null;

  constructor(private readonly deps: EngineDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  get error(): HumanError | null {
    return this.lastError;
  }

  /**
   * One sync pass. Never throws: a failure becomes `lastError` plus, for anything
   * the user can act on, a Notice.
   *
   * Returns `null` when the pass was skipped — already running, no token, or
   * offline. A skip is not a failure and must not overwrite `lastSync`.
   */
  async run(trigger: 'interval' | 'manual' | 'startup'): Promise<SyncResult | null> {
    if (this.running) return null;

    const settings = this.deps.settings();
    if (!settings.botToken) return null;
    if (!navigator.onLine) {
      // Silent skip, per TZ §5.4. Every 30 s on a train is not a notification.
      return null;
    }

    this.running = true;
    try {
      const result = await this.pass();
      this.lastError = null;
      await this.deps.persist({ lastSync: { at: Date.now(), ok: true, count: result.written } });
      return result;
    } catch (e) {
      const err = toHumanError(e);
      this.lastError = err;

      // A conflict means the other device is doing the work. Offline means try
      // again in thirty seconds. Neither is worth a popup, and neither is worth
      // recording as a failed sync.
      if (!isRetryable(err)) {
        this.deps.onNotice(err);
        await this.deps.persist({ lastSync: { at: Date.now(), ok: false, errorKey: err.key } });
      }
      return null;
    } finally {
      this.running = false;
      void trigger;
    }
  }

  private async pass(): Promise<SyncResult> {
    const settings = this.deps.settings();
    const { messages, cursor, skipped } = await this.deps.source.poll(settings.cursor);

    if (messages.length === 0) {
      // Still advance: the batch may have been all non-text or all foreign, and
      // an unconfirmed update is redelivered forever.
      if (cursor !== undefined) await this.deps.persist({ cursor });
      return { written: 0, skipped: { ...skipped, duplicate: 0 } };
    }

    let written = 0;
    let duplicate = 0;

    // Messages sent either side of midnight belong to different notes. Group by
    // destination so each note is opened and written exactly once.
    for (const [path, batch] of this.groupByNote(messages)) {
      // Deduplication happens inside the writer, against the note as it exists at
      // the instant of the write. Doing it here, against content read a moment
      // earlier, is how a note that arrived over vault sync in between produces
      // duplicates.
      const entries = batch.map((m) => this.toEntry(m));
      const count = await this.deps.writer.appendEntries(path, settings.heading, entries);
      written += count;
      duplicate += entries.length - count;
    }

    // The cursor moves only after every line is on disk. Crash halfway and the
    // next pass re-reads those updates, finds them recorded, and writes nothing.
    if (cursor !== undefined) await this.deps.persist({ cursor });

    return { written, skipped: { ...skipped, duplicate } };
  }

  private groupByNote(messages: InboundMessage[]): Map<string, InboundMessage[]> {
    const settings = this.deps.settings();
    const groups = new Map<string, InboundMessage[]>();

    for (const m of messages) {
      const path = resolveDailyNotePath(settings, new Date(m.date * 1000), this.deps.format);
      const bucket = groups.get(path);
      if (bucket) bucket.push(m);
      else groups.set(path, [m]);
    }
    return groups;
  }

  private toEntry(m: InboundMessage): NoteEntry {
    const s = this.deps.settings();
    const when = new Date(m.date * 1000);
    const lines = renderEntry(
      m.text,
      { template: s.lineTemplate, blockStyle: s.blockStyle, calloutType: s.calloutType },
      { time: this.deps.format('HH:mm', when), date: this.deps.format('YYYY-MM-DD', when) },
    );
    return { key: markerKey(m), lines };
  }
}

import { normalizePath, TFile, type App } from 'obsidian';
import { HumanError } from '../errors';
import { t } from '../i18n';
import type { DownloadedFile, InboundMessage } from '../telegram/types';
import { parentFolderOf } from './daily-note';

/**
 * Getting one attachment from Telegram's cloud into the vault. SPEC v0.2.
 *
 * The contract with the engine is one string: the Markdown line that represents
 * the attachment in the note — an `![[embed]]` on success, a placeholder when
 * Telegram refuses the file (the Bot API serves nothing over 20 MB). Transient
 * failures (network, rate limit) are *thrown*, not swallowed: the engine's
 * cursor logic then re-fetches the whole batch, and deduplication makes the
 * retry cheap.
 *
 * File names are deterministic per message. A pass that crashed between the
 * binary write and the note write re-downloads to the *same* path and finds it
 * already there — idempotence instead of `photo 1.jpg`, `photo 2.jpg`.
 */

export interface AttachmentSink {
  /** The Markdown line for this message's attachment. Throws only what is worth retrying. */
  save(m: InboundMessage, notePath: string): Promise<string>;
}

/** The Bot API's documented ceiling for `getFile`. */
export const MAX_BOT_FILE_BYTES = 20 * 1024 * 1024;

/** Mirrors `ILLEGAL_IN_FILENAME` in daily-note.ts, plus the path separators an original name must not smuggle in. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/**
 * `TG-<date>-<messageId><ext>`, or `<original stem> TG-<messageId><ext>` when
 * Telegram preserved an original name (documents, audio). The `TG-<messageId>`
 * suffix is the determinism; the stem is for the human scanning a folder.
 */
export function attachmentFileName(m: InboundMessage, dateStr: string, serverExt: string): string {
  const original = m.attachment?.fileName?.trim() ?? '';
  const dot = original.lastIndexOf('.');
  const stem = (dot > 0 ? original.slice(0, dot) : original).replace(ILLEGAL, '').trim();
  const originalExt = dot > 0 ? original.slice(dot).replace(ILLEGAL, '') : '';
  const ext = originalExt || serverExt;

  if (stem !== '') return `${stem} TG-${m.messageId}${ext}`;
  return `TG-${dateStr}-${m.messageId}${ext}`;
}

export function embedLine(path: string): string {
  return `![[${path}]]`;
}

export interface VaultAttachmentDeps {
  app: App;
  download: (fileId: string) => Promise<DownloadedFile>;
  /** Renders `YYYY-MM-DD` for the file name. Injected for the same reason daily-note.ts injects it. */
  format: (template: string, date: Date) => string;
}

export class VaultAttachmentStore implements AttachmentSink {
  constructor(private readonly deps: VaultAttachmentDeps) {}

  async save(m: InboundMessage, notePath: string): Promise<string> {
    const a = m.attachment;
    if (!a) return '';

    // Known-oversize: skip the doomed round-trip entirely.
    if (a.fileSize !== undefined && a.fileSize > MAX_BOT_FILE_BYTES) {
      return t('entry.attachmentTooBig');
    }

    let file: DownloadedFile;
    try {
      file = await this.deps.download(a.fileId);
    } catch (e) {
      if (e instanceof HumanError && e.key === 'error.fileTooBig') return t('entry.attachmentTooBig');
      throw e;
    }

    const name = attachmentFileName(m, this.deps.format('YYYY-MM-DD', new Date(m.date * 1000)), file.ext);
    const target = await this.targetPath(name, notePath);

    if (!(this.deps.app.vault.getAbstractFileByPath(target) instanceof TFile)) {
      await this.ensureFolder(parentFolderOf(target));
      await this.deps.app.vault.createBinary(target, file.data);
    }
    return embedLine(target);
  }

  /**
   * The user's own "attachment folder" setting decides *where*; our
   * deterministic name decides *what*. `getAvailablePathForAttachment` is asked
   * only for the folder — its de-duplicating suffix (`name 1.jpg`) is exactly
   * what idempotence must avoid.
   */
  private async targetPath(name: string, notePath: string): Promise<string> {
    const available = await this.deps.app.fileManager.getAvailablePathForAttachment(name, notePath);
    const folder = parentFolderOf(available);
    return normalizePath(folder === '' ? name : `${folder}/${name}`);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (folder === '' || this.deps.app.vault.getAbstractFileByPath(folder)) return;
    try {
      await this.deps.app.vault.createFolder(folder);
    } catch {
      // Racing another device's sync is a success, not a failure.
      if (!this.deps.app.vault.getAbstractFileByPath(folder)) throw new Error(`cannot create folder ${folder}`);
    }
  }
}

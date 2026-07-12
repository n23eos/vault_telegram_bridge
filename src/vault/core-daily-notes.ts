import type { App } from 'obsidian';
import { stripSlashes } from '../settings';
import type { DateFormatter } from './daily-note';

/**
 * Reading the core Daily Notes plugin's settings, so the toggle in our settings
 * can mean "write into the *real* daily note — its folder, its name, its
 * template".
 *
 * `app.internalPlugins` is undocumented API, which is why ADR-001 deferred
 * this. The exposure is contained: this file is the only one that touches it,
 * everything read is re-validated as if hostile, and every failure path returns
 * `null` — callers then fall back to the plugin's own folder/format settings.
 */

export interface CoreDailyNoteOptions {
  folder: string;
  format: string;
  /** Vault path of the template note, possibly without `.md`. `''` when unset. */
  template: string;
}

/** The undocumented shape, held at arm's length. */
interface InternalPluginsHost {
  internalPlugins?: {
    getPluginById?: (id: string) => { enabled?: boolean; instance?: { options?: unknown } } | null;
  };
}

/** Coerce whatever `instance.options` holds into usable options. Total: garbage in, defaults out. */
export function parseCoreOptions(raw: unknown): CoreDailyNoteOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    folder: typeof o.folder === 'string' ? stripSlashes(o.folder) : '',
    format: typeof o.format === 'string' && o.format.trim() !== '' ? o.format.trim() : 'YYYY-MM-DD',
    template: typeof o.template === 'string' ? o.template.trim() : '',
  };
}

/** `null` means "not available" — the plugin is disabled, or the API moved. */
export function readCoreDailyNoteOptions(app: App): CoreDailyNoteOptions | null {
  try {
    const dn = (app as unknown as InternalPluginsHost).internalPlugins?.getPluginById?.('daily-notes');
    if (!dn || dn.enabled !== true) return null;
    return parseCoreOptions(dn.instance?.options);
  } catch {
    return null;
  }
}

/**
 * The variables the core plugin substitutes when it creates a daily note:
 * `{{date}}`, `{{time}}`, `{{title}}`, and the `{{date:FORMAT}}` variants.
 * Case-insensitive with optional inner whitespace, matching the core plugin.
 * Anything else — Templater syntax, `{{yesterday}}` — is left alone rather than
 * half-imitated.
 */
export function renderDailyTemplate(template: string, date: Date, format: DateFormatter, title: string): string {
  return template
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/gi, (_, f: string) => format(f, date))
    .replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/gi, (_, f: string) => format(f, date))
    .replace(/\{\{\s*date\s*\}\}/gi, format('YYYY-MM-DD', date))
    .replace(/\{\{\s*time\s*\}\}/gi, format('HH:mm', date))
    .replace(/\{\{\s*title\s*\}\}/gi, title);
}

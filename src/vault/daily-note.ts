import { normalizePath } from 'obsidian';
import { errBadTemplate } from '../errors';

/**
 * Resolves the one note that holds a given day's messages.
 *
 * v0.1 deliberately does **not** read Obsidian's core Daily Notes settings.
 * Doing so means reaching into `app.internalPlugins`, which is undocumented, may
 * be disabled, and needs testing against a user's own format. ADR-001 defers
 * that to v0.2. Here the folder and the filename template are ours, and the
 * behaviour is the same whether or not the core plugin exists.
 *
 * Date formatting is injected rather than imported so this module can be tested
 * without an Obsidian runtime. Production passes Obsidian's bundled Moment.
 */

export type DateFormatter = (template: string, date: Date) => string;

/**
 * Characters that break a file name on at least one platform Obsidian runs on.
 * `/` is excluded on purpose: a template may legitimately contain it to nest by
 * month (`YYYY/MM/YYYY-MM-DD`).
 */
const ILLEGAL_IN_FILENAME = /[\\:*?"<>|#^[\]]/;

export interface DailyNoteSettings {
  folder: string;
  filenameTemplate: string;
}

/**
 * Vault-relative path, `normalizePath`ed. Throws `HumanError` when the template
 * renders to something unusable — an empty name, a traversal, an illegal char.
 *
 * The template is user input, and a user who types `..` or `Q3?` deserves a
 * sentence rather than a silent write to the wrong place, or a crash.
 */
export function resolveDailyNotePath(
  settings: DailyNoteSettings,
  date: Date,
  format: DateFormatter,
): string {
  const rendered = format(settings.filenameTemplate, date).trim();

  if (rendered === '') throw errBadTemplate(settings.filenameTemplate);
  if (ILLEGAL_IN_FILENAME.test(rendered)) throw errBadTemplate(settings.filenameTemplate);

  // `..` anywhere in the rendered name would climb out of the vault.
  if (rendered.split('/').some((seg) => seg === '..' || seg === '.' || seg.trim() === '')) {
    throw errBadTemplate(settings.filenameTemplate);
  }

  const folder = settings.folder.trim();
  const raw = folder === '' ? `${rendered}.md` : `${folder}/${rendered}.md`;
  return normalizePath(raw);
}

/** Everything up to the last `/`. `''` for a note in the vault root. */
export function parentFolderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

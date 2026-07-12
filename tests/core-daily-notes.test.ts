import { describe, expect, it } from 'vitest';
import { parseCoreOptions, renderDailyTemplate } from '../src/vault/core-daily-notes';

const fmt = (template: string, date: Date): string =>
  template
    .replace(/YYYY/g, String(date.getUTCFullYear()))
    .replace(/MM/g, String(date.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/DD/g, String(date.getUTCDate()).padStart(2, '0'))
    .replace(/HH/g, String(date.getUTCHours()).padStart(2, '0'))
    .replace(/mm/g, String(date.getUTCMinutes()).padStart(2, '0'));

const D = new Date(Date.UTC(2026, 6, 8, 9, 12));

describe('parseCoreOptions — the options object is undocumented, so trust nothing', () => {
  it('parses a well-formed options object', () => {
    expect(parseCoreOptions({ folder: 'Journal/', format: 'DD.MM.YYYY', template: 'Templates/Daily' })).toEqual({
      folder: 'Journal',
      format: 'DD.MM.YYYY',
      template: 'Templates/Daily',
    });
  });

  it('degrades garbage to defaults', () => {
    expect(parseCoreOptions(null)).toEqual({ folder: '', format: 'YYYY-MM-DD', template: '' });
    expect(parseCoreOptions('nope')).toEqual({ folder: '', format: 'YYYY-MM-DD', template: '' });
    expect(parseCoreOptions({ folder: 7, format: '', template: [] })).toEqual({
      folder: '',
      format: 'YYYY-MM-DD',
      template: '',
    });
  });
});

describe('renderDailyTemplate — the {{...}} variables the core plugin documents', () => {
  it('substitutes {{date}}, {{time}} and {{title}}', () => {
    const r = renderDailyTemplate('# {{title}}\n\n{{date}} {{time}}', D, fmt, '2026-07-08');
    expect(r).toBe('# 2026-07-08\n\n2026-07-08 09:12');
  });

  it('substitutes {{date:FORMAT}} and {{time:FORMAT}}', () => {
    expect(renderDailyTemplate('{{date:DD.MM.YYYY}} at {{time:HH}}', D, fmt, 'x')).toBe('08.07.2026 at 09');
  });

  it('is case-insensitive and tolerates inner spaces, as the core plugin is', () => {
    expect(renderDailyTemplate('{{ DATE }} {{Title}}', D, fmt, 'note')).toBe('2026-07-08 note');
  });

  it('leaves unknown variables for Templater et al. untouched', () => {
    expect(renderDailyTemplate('{{tp.date}} {{yesterday}}', D, fmt, 'x')).toBe('{{tp.date}} {{yesterday}}');
  });
});

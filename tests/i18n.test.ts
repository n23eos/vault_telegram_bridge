import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '../src/i18n';

afterEach(() => setLocale('en'));

describe('i18n', () => {
  it('selects Russian for ru and regional Russian locales', () => {
    setLocale('ru-RU');
    expect(t('settings.section.destination')).toBe('Куда сохранять сообщения');
    expect(t('settings.transcription.name')).toBe('Расшифровывать голосовые сообщения');
  });

  it('interpolates Russian placeholders', () => {
    setLocale('ru');
    expect(t('notice.synced', { n: 3 })).toBe('Telegram: новых записей — 3');
  });

  it('falls back to English for an unsupported locale', () => {
    setLocale('ka-GE');
    expect(t('settings.section.destination')).toBe('Where messages go');
  });
});

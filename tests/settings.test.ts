import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  looksLikeBotToken,
  MAX_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  migrate,
  stripSlashes,
} from '../src/settings';

describe('migrate', () => {
  it('returns defaults for a fresh install', () => {
    expect(migrate(null)).toEqual(DEFAULT_SETTINGS);
    expect(migrate(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrate({})).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults rather than throwing on garbage', () => {
    expect(migrate('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(migrate(42)).toEqual(DEFAULT_SETTINGS);
    expect(migrate([])).toEqual(DEFAULT_SETTINGS);
  });

  it('always stamps the current schema version', () => {
    expect(migrate({ version: 0 }).version).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrate({ version: 99 }).version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('round-trips a valid object', () => {
    const s = {
      version: CURRENT_SCHEMA_VERSION,
      botToken: '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      boundChatId: '-100123',
      folder: 'Inbox',
      filenameTemplate: 'YYYY-MM-DD',
      heading: '## TG',
      lineTemplate: '✏️ {time} {text}',
      blockStyle: 'callout' as const,
      calloutType: 'tip',
      syncIntervalSeconds: 45,
      cursor: 12,
      lastSync: { at: 1, ok: true, count: 3 },
    };
    expect(migrate(s)).toEqual(s);
  });

  describe('v1 → v2', () => {
    const v1 = { version: 1, folder: 'Inbox', heading: '## TG', cursor: 5 };

    it('carries the v1 bullet into the new template, so notes keep their shape', () => {
      expect(migrate(v1).lineTemplate).toBe('- {time} {text}');
    });

    it('defaults the new fields', () => {
      const s = migrate(v1);
      expect(s.blockStyle).toBe('plain');
      expect(s.calloutType).toBe('note');
    });

    it('preserves every v1 field', () => {
      const s = migrate(v1);
      expect(s.folder).toBe('Inbox');
      expect(s.heading).toBe('## TG');
      expect(s.cursor).toBe(5);
    });

    it('stamps the new version', () => {
      expect(migrate(v1).version).toBe(2);
    });
  });

  describe('format fields', () => {
    it('rejects an unknown block style', () => {
      expect(migrate({ blockStyle: 'marquee' }).blockStyle).toBe('plain');
    });

    it('accepts the three known styles', () => {
      for (const style of ['plain', 'code', 'callout']) {
        expect(migrate({ blockStyle: style }).blockStyle).toBe(style);
      }
    });

    it('rejects an empty line template', () => {
      expect(migrate({ lineTemplate: '   ' }).lineTemplate).toBe(DEFAULT_SETTINGS.lineTemplate);
    });

    it('flattens a multi-line template — one message is one entry', () => {
      expect(migrate({ lineTemplate: '{time}\n{text}' }).lineTemplate).toBe('{time} {text}');
    });

    it('rejects a callout type that would break the [!…] syntax', () => {
      expect(migrate({ calloutType: 'note]\n> evil' }).calloutType).toBe('note');
      expect(migrate({ calloutType: '' }).calloutType).toBe('note');
      expect(migrate({ calloutType: 'tip' }).calloutType).toBe('tip');
    });
  });

  it('keeps the good fields when one is corrupt', () => {
    const s = migrate({ version: 1, folder: 'Inbox', heading: 12345, filenameTemplate: '' });
    expect(s.folder).toBe('Inbox');
    expect(s.heading).toBe(DEFAULT_SETTINGS.heading);
    expect(s.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
  });

  it('clamps an out-of-range interval instead of rejecting the file', () => {
    expect(migrate({ syncIntervalSeconds: 1 }).syncIntervalSeconds).toBe(MIN_SYNC_INTERVAL_SECONDS);
    expect(migrate({ syncIntervalSeconds: 999_999 }).syncIntervalSeconds).toBe(MAX_SYNC_INTERVAL_SECONDS);
    expect(migrate({ syncIntervalSeconds: 45.6 }).syncIntervalSeconds).toBe(46);
    expect(migrate({ syncIntervalSeconds: NaN }).syncIntervalSeconds).toBe(
      DEFAULT_SETTINGS.syncIntervalSeconds,
    );
  });

  it('drops a boundChatId that is not a chat id', () => {
    expect(migrate({ boundChatId: 'me' }).boundChatId).toBeNull();
    expect(migrate({ boundChatId: '' }).boundChatId).toBeNull();
    expect(migrate({ boundChatId: '-100123' }).boundChatId).toBe('-100123');
  });

  it('drops a nonsensical cursor', () => {
    expect(migrate({ cursor: -1 }).cursor).toBeUndefined();
    expect(migrate({ cursor: 1.5 }).cursor).toBeUndefined();
    expect(migrate({ cursor: '7' }).cursor).toBeUndefined();
    expect(migrate({ cursor: 0 }).cursor).toBe(0);
  });

  it('drops a malformed lastSync', () => {
    expect(migrate({ lastSync: { at: 'now' } }).lastSync).toBeNull();
    expect(migrate({ lastSync: { at: 1, ok: true } }).lastSync).toEqual({ at: 1, ok: true });
  });

  it('trims the token and normalises the folder', () => {
    const s = migrate({ botToken: '  123:abc  ', folder: '/Inbox/TG/' });
    expect(s.botToken).toBe('123:abc');
    expect(s.folder).toBe('Inbox/TG');
  });

  it('never mutates the caller’s object', () => {
    const raw = { version: 1, folder: 'x' };
    migrate(raw);
    expect(raw).toEqual({ version: 1, folder: 'x' });
  });

  it('never mutates DEFAULT_SETTINGS', () => {
    migrate({ folder: 'mutated' });
    expect(DEFAULT_SETTINGS.folder).toBe('');
  });
});

describe('stripSlashes', () => {
  it('normalises the vault root to the empty string', () => {
    expect(stripSlashes('/')).toBe('');
    expect(stripSlashes('  ')).toBe('');
  });

  it('strips leading and trailing slashes only', () => {
    expect(stripSlashes('/a/b/')).toBe('a/b');
    expect(stripSlashes('a/b')).toBe('a/b');
  });
});

describe('looksLikeBotToken', () => {
  it('accepts a realistic token', () => {
    expect(looksLikeBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(looksLikeBotToken('  123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw ')).toBe(true);
  });

  it('rejects the obvious mistakes', () => {
    expect(looksLikeBotToken('')).toBe(false);
    expect(looksLikeBotToken('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false); // no bot id
    expect(looksLikeBotToken('123456789:short')).toBe(false);
    expect(looksLikeBotToken('123:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false); // bot id too short
    expect(looksLikeBotToken('123456789 AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw')).toBe(false); // space, not colon
    expect(looksLikeBotToken('https://api.telegram.org/bot123:abc')).toBe(false);
  });
});

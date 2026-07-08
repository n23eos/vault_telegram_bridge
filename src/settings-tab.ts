import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import { HumanError } from './errors';
import { t } from './i18n';
import type TelegramInboxPlugin from './main';
import { formatDate } from './main';
import {
  BLOCK_STYLES,
  looksLikeBotToken,
  MAX_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  stripSlashes,
} from './settings';
import { joinEntries, renderEntry, type BlockStyle } from './sync/render';
import { resolveDailyNotePath } from './vault/daily-note';

/** SPEC §6, MVP screen. Connect, destination, sync, status. Nothing else. */
export class SettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: TelegramInboxPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      ...this.connectionDefinitions(),
      { type: 'group', heading: t('settings.section.destination'), items: this.destinationDefinitions() },
      { type: 'group', heading: t('settings.section.format'), items: this.formatDefinitions() },
      { type: 'group', heading: t('settings.section.sync'), items: this.syncDefinitions() },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    switch (key) {
      case 'folder':
        return s.folder;
      case 'heading':
        return s.heading;
      case 'lineTemplate':
        return s.lineTemplate;
      case 'blockStyle':
        return s.blockStyle;
      case 'calloutType':
        return s.calloutType;
      case 'syncIntervalSeconds':
        // The slider tops out at 300; anything stored above that shows as 300.
        return Math.min(s.syncIntervalSeconds, 300);
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case 'folder':
        s.folder = stripSlashes(String(value));
        break;
      case 'heading': {
        const next = String(value).trim();
        if (next === '') return;
        s.heading = next;
        break;
      }
      case 'lineTemplate': {
        const v = String(value);
        if (v.trim() === '') return;
        s.lineTemplate = v.replace(/\n/g, ' ').trimEnd();
        break;
      }
      case 'blockStyle':
        s.blockStyle = value as BlockStyle;
        break;
      case 'calloutType': {
        const v = String(value).trim();
        if (!/^[A-Za-z-]+$/.test(v)) return;
        s.calloutType = v;
        break;
      }
      case 'syncIntervalSeconds':
        s.syncIntervalSeconds = Math.min(
          Math.max(Number(value), MIN_SYNC_INTERVAL_SECONDS),
          MAX_SYNC_INTERVAL_SECONDS,
        );
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
    switch (key) {
      case 'blockStyle':
        // The callout-type field and the code-block warning appear and vanish.
        this.refreshDomState();
        this.refreshPreview();
        break;
      case 'lineTemplate':
      case 'calloutType':
        this.refreshDomState();
        this.refreshPreview();
        break;
      case 'syncIntervalSeconds':
        this.plugin.restartTimer();
        break;
    }
  }

  /* ---------------- connection ---------------- */

  private connectionDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    return [
      {
        name: t('settings.token.name'),
        desc: t('settings.token.desc'),
        render: (setting: Setting) => {
          setting
            .addText((text) => {
              text
                .setPlaceholder(t('settings.token.placeholder'))
                .setValue(s.botToken)
                .onChange(async (v) => {
                  s.botToken = v.trim();
                  await this.plugin.saveSettings();
                  this.refreshDomState();
                });
              // A bot token is a credential. Do not render it in the clear next to a
              // screen the user might be sharing.
              text.inputEl.type = 'password';
              text.inputEl.autocomplete = 'off';
            })
            .addButton((b) =>
              b
                .setButtonText(t('settings.token.connect'))
                .setCta()
                .onClick(async () => {
                  if (!looksLikeBotToken(s.botToken)) {
                    new Notice(t('error.tokenShape'));
                    return;
                  }
                  try {
                    const name = await this.plugin.reconnect();
                    new Notice(t('settings.token.connected', { name }));
                  } catch (e) {
                    new Notice(e instanceof HumanError ? e.human : t('error.unknown', { message: String(e) }));
                  }
                  this.update();
                }),
            );
        },
      },
      {
        name: t('settings.disconnect.name'),
        desc: t('settings.disconnect.desc'),
        visible: () => this.plugin.client.status() === 'connected' || this.plugin.settings.botToken !== '',
        render: (setting: Setting) => {
          setting.addButton((b) =>
            b
              .setButtonText(t('settings.disconnect.button'))
              .setDestructive()
              .onClick(async () => {
                await this.plugin.client.wipe();
                s.botToken = '';
                s.boundChatId = null;
                s.cursor = undefined;
                await this.plugin.saveSettings();
                new Notice(t('settings.disconnect.done'));
                this.update();
              }),
          );
        },
      },
      {
        name: t('settings.boundChat.name'),
        desc: t('settings.boundChat.desc'),
        render: (setting: Setting) => {
          if (s.boundChatId) {
            setting.addExtraButton((b) =>
              b
                .setIcon('rotate-ccw')
                .setTooltip(t('settings.boundChat.reset'))
                .onClick(async () => {
                  s.boundChatId = null;
                  await this.plugin.saveSettings();
                  new Notice(t('settings.boundChat.resetDone'));
                  this.update();
                }),
            );
            setting.descEl.createEl('div', {
              text: t('settings.boundChat.bound', { chatId: s.boundChatId }),
              cls: 'mod-success',
            });
          } else {
            setting.descEl.createEl('div', { text: t('settings.boundChat.none') });
          }
        },
      },
    ];
  }

  /* ---------------- destination ---------------- */

  private destinationDefinitions(): SettingGroupItem[] {
    const s = this.plugin.settings;
    return [
      {
        name: t('settings.folder.name'),
        desc: t('settings.folder.desc'),
        control: { type: 'text', key: 'folder', placeholder: t('settings.folder.placeholder') },
      },
      {
        name: t('settings.filename.name'),
        render: (setting: Setting) => {
          const updatePreview = () => {
            setting.setDesc(t('settings.filename.desc', { preview: this.previewPath() }));
          };
          updatePreview();

          setting.addText((text) =>
            text
              .setPlaceholder(t('settings.filename.placeholder'))
              .setValue(s.filenameTemplate)
              .onChange(async (v) => {
                s.filenameTemplate = v.trim();
                await this.plugin.saveSettings();
                // Live preview is the whole reason a template field is tolerable.
                updatePreview();
              }),
          );
        },
      },
      {
        name: t('settings.heading.name'),
        desc: t('settings.heading.desc'),
        control: { type: 'text', key: 'heading' },
      },
    ];
  }

  /* ---------------- format ---------------- */

  private formatDefinitions(): SettingGroupItem[] {
    return [
      {
        name: t('settings.template.name'),
        desc: t('settings.template.desc'),
        control: { type: 'text', key: 'lineTemplate', placeholder: t('settings.template.placeholder') },
      },
      {
        name: t('settings.blockStyle.name'),
        control: {
          type: 'dropdown',
          key: 'blockStyle',
          options: Object.fromEntries(BLOCK_STYLES.map((style) => [style, t(`settings.blockStyle.${style}`)])),
        },
      },
      {
        name: '',
        desc: t('settings.blockStyle.codeWarning'),
        visible: () => this.plugin.settings.blockStyle === 'code',
        searchable: false,
      },
      {
        name: t('settings.calloutType.name'),
        desc: t('settings.calloutType.desc'),
        visible: () => this.plugin.settings.blockStyle === 'callout',
        control: { type: 'text', key: 'calloutType' },
      },
      {
        name: t('settings.preview.name'),
        render: (setting: Setting) => {
          this.previewEl = setting.controlEl.createEl('pre', { cls: 'telegram-inbox-preview' });
          this.refreshPreview();
          return () => {
            this.previewEl = null;
          };
        },
      },
      {
        name: '',
        desc: t('error.noTextPlaceholder'),
        visible: () => !this.plugin.settings.lineTemplate.includes('{text}'),
        searchable: false,
      },
    ];
  }

  /**
   * Two entries, one of them multi-line, so the user sees the separator and the
   * continuation behaviour rather than guessing at them.
   */
  private refreshPreview(): void {
    if (!this.previewEl) return;
    const s = this.plugin.settings;
    const opts = { template: s.lineTemplate, blockStyle: s.blockStyle, calloutType: s.calloutType };
    const entries = [
      renderEntry('an idea on a walk', opts, { time: '15:29', date: '2026-07-08' }),
      renderEntry('a longer one\nspilling onto a second line', opts, { time: '15:30', date: '2026-07-08' }),
    ];
    this.previewEl.setText([s.heading, '', ...joinEntries(entries)].join('\n'));
  }

  private previewEl: HTMLElement | null = null;

  /** Renders today's destination, or the reason the template is unusable. */
  private previewPath(): string {
    try {
      return resolveDailyNotePath(this.plugin.settings, new Date(), formatDate);
    } catch (e) {
      return e instanceof HumanError ? e.human : String(e);
    }
  }

  /* ---------------- sync ---------------- */

  private syncDefinitions(): SettingGroupItem[] {
    return [
      {
        name: t('settings.interval.name'),
        desc: t('settings.interval.desc'),
        control: {
          type: 'slider',
          key: 'syncIntervalSeconds',
          min: MIN_SYNC_INTERVAL_SECONDS,
          max: 300,
          step: 15,
        },
      },
      {
        name: t('settings.syncNow.name'),
        render: (setting: Setting) => {
          setting.addButton((b) =>
            b.setButtonText(t('settings.syncNow.button')).onClick(async () => {
              await this.plugin.syncNow('manual');
              this.update();
            }),
          );
        },
      },
      { name: t('settings.status.name'), desc: this.statusText() },
    ];
  }

  private statusText(): string {
    const { engine, settings } = this.plugin;
    if (engine.isRunning) return t('settings.status.running');

    const last = settings.lastSync;
    if (!last) return t('settings.status.never');

    const time = formatDate('YYYY-MM-DD HH:mm', new Date(last.at));
    if (!last.ok) {
      return t('settings.status.error', {
        time,
        message: engine.error?.human ?? t('error.unknown', { message: last.errorKey ?? '' }),
      });
    }
    return last.count
      ? t('settings.status.ok', { time, n: last.count })
      : t('settings.status.okNothing', { time });
  }
}

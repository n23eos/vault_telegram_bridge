# Vault Telegram Bridge

Send yourself a message in Telegram — it appears in your Obsidian daily note.

No server, no VPS, no Docker. Works on desktop and mobile.

![A message sent to the bot in Telegram appears in the Obsidian daily note](https://raw.githubusercontent.com/N23eos/vault_telegram_bridge/main/docs/screenshots/capture.jpg)

## How it works

1. Create a Telegram bot (thirty seconds) and paste its token into the plugin.
2. Send the bot anything — a thought on a walk, a link, a photo, a voice note, a file.
3. Next time Obsidian is open, it lands in that day's note, under a heading you choose.

Text keeps its Telegram formatting — bold, italic, links, code arrive as Markdown. Photos, voice notes and documents are saved into your vault's attachment folder and embedded in the entry, caption included.

Folder, note name and heading are configurable — or flip one toggle and the plugin writes into the daily note the core **Daily Notes** plugin owns: its folder, its name format, its template. Delivered message IDs are recorded in the note's frontmatter (`tg_ids`) — hidden in Reading View, travelling with the note — so two devices syncing one vault never produce duplicates.

Capture is instant; **delivery happens while Obsidian is open**. The plugin polls Telegram every thirty seconds, and there is no background execution on mobile. If Obsidian is closed, your message waits.

## Setup

**1. Create a bot.** Message [@BotFather](https://t.me/botfather) in Telegram: `/newbot`, answer two prompts (a display name, then a username ending in `bot`), copy the token it gives you.

![Creating a bot with @BotFather: New Bot, pick a name and username, copy the token](https://raw.githubusercontent.com/N23eos/vault_telegram_bridge/main/docs/screenshots/botfather.jpg)

**2. Connect the plugin.** Obsidian → Settings → Vault Telegram Bridge → paste the token → **Connect**. The same screen sets where messages go (folder, note name, heading) and how each entry looks.

![Plugin settings: bot token, target folder and note name, heading, line format](https://raw.githubusercontent.com/N23eos/vault_telegram_bridge/main/docs/screenshots/settings.jpg)

**3. Send your new bot a message.** That chat is now bound to the plugin; messages from any other chat are ignored.

## Entry format

One **line format** setting decides everything: `{time}`, `{date}` and `{text}` are replaced, the rest is literal — emoji, bold markers, a `- ` bullet all go in the same field. Entries are separated by a blank line.

```markdown
✏️ **15:29** an idea on a walk

✏️ **15:30** a longer one
spilling onto a second line
```

Each entry can be wrapped in nothing, a fenced code block (Markdown is inert there), or a callout (boxed, formatting works):

```markdown
> [!tip]
> ✏️ **15:29** an idea on a walk
```

## Network use

The plugin talks to exactly one host, and only once you have configured a token: `https://api.telegram.org` — Telegram's Bot API, over HTTPS, through Obsidian's `requestUrl`. Three methods: `getMe`, once, to verify the token; `getUpdates`, on a timer, to fetch messages sent to your bot; `getFile` plus a file download, only when a message carries an attachment.

No telemetry, no analytics, no crash reporting, no remote configuration, no self-updating, no server of ours anywhere. **Zero runtime dependencies** — everything it needs is Obsidian's own API.

A future version will add optional voice transcription — a second endpoint, called with an API key you provide. Declared now, before it exists, because that is what the catalogue's disclosure rule is for.

## Security

The plugin holds one secret: a bot token, stored in plain text in `data.json` inside your Obsidian config folder. A stolen token gives an attacker control of the *bot* — reading messages sent to it, posting as it — and nothing else. Not your chats, not your contacts, not your account. Revoking takes thirty seconds: `/revoke` to @BotFather. (The plugin's **Disconnect** button removes the token from this vault but does not disable the bot elsewhere.)

If you sync `.obsidian/` through git, iCloud or Obsidian Sync, the token goes with it. Because it is not an account credential and revoking is trivial, the plugin does not put a passphrase in front of it — that would be security theatre paid for on every launch. If your vault is public, add the plugin's `data.json` to `.gitignore`.

Bot usernames are guessable, so the plugin binds itself to the first chat that writes to it and silently ignores every other chat. The binding is visible and resettable in settings.

The plugin will never send messages, set reactions, read chats you did not point it at, collect telemetry, phone home, or update itself.

## Known limits

- **Messages expire after 24 hours.** Telegram queues undelivered bot updates for one day. If Obsidian stays closed longer, the message survives only in the chat with your bot. Account mode (planned — Saved Messages sync, nothing expires) has no such limit; see [ADR-001](docs/ADR-001-bot-mode-first.md) for why bot mode ships first.
- **Files over 20 MB stay in Telegram.** The bot API refuses to serve them; the entry gets a placeholder line instead of the file. Stickers, polls and locations are counted and skipped.
- **One poller per bot.** If desktop and phone are both open, one wins the poll and the other backs off; the note reaches it through your normal vault sync. Handled, not an error.
- **Edits and deletions in Telegram don't touch the note.** Deliberate: the note is yours.

## Development

```bash
npm install
npm test          # unit tests, no Obsidian runtime needed
npm run typecheck # strict
npm run build     # typecheck + lint + bundle to main.js
```

The build fails if any code imports a Node or Electron API (the plugin must run on mobile), or if the product bundle imports GramJS (account-mode work; used only by the Phase 0 spike under `spikes/`).

Worth reading before changing anything: [ADR-001](docs/ADR-001-bot-mode-first.md) — why bot mode ships first; [SPIKE-REPORT](docs/SPIKE-REPORT.md) — Phase 0 findings, including a duplication bug the obvious implementation would have shipped; [SECURITY-DECISION](docs/SECURITY-DECISION.md) — account-mode session storage; [MANUAL-TEST-GUIDE](docs/MANUAL-TEST-GUIDE.md) — checks that need a human and a real phone.

## Licence

MIT.

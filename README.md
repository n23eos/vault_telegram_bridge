# Telegram Inbox

Send yourself a message in Telegram. It shows up in your Obsidian daily note.

No server, no VPS, no Docker. Works on desktop and mobile.

> **v0.1 — bot mode.** You create a bot with [@BotFather](https://t.me/botfather) and message it. Account mode — connecting Telegram as your own account, so that Saved Messages sync and nothing expires — is planned for v0.3. See [ADR-001](docs/ADR-001-bot-mode-first.md) for why that order.

## What it does

1. You create a Telegram bot in thirty seconds and paste its token into the plugin.
2. You send that bot a message. Anything — a thought on a walk, a link, a line from a meeting.
3. Next time Obsidian is open, the message is appended to that day's note, under a heading you choose.

One note holds one day. The folder and the note's name are yours to configure. Messages already in the note are never written twice, even with a desktop and a phone syncing the same vault.

## How entries look

A single **line format** setting decides everything. `{time}`, `{date}` and `{text}` are replaced; the rest is written literally, so an emoji, bold markers or a `- ` bullet all go in the same field.

Each entry can be wrapped in nothing, a fenced code block, or a callout:

```markdown
✏️ **15:29** an idea on a walk

✏️ **15:30** a longer one
spilling onto a second line
```

Inside a **code block** Markdown is inert — `**bold**` shows its asterisks, links stay as text. If you want a boxed entry with formatting, use a **callout** instead:

```markdown
> [!tip]
> ✏️ **15:29** an idea on a walk
```

Entries are separated by a blank line. Without bullets, two adjacent lines are a single Markdown paragraph, so the blank line is what keeps them apart.

The plugin records which messages it has already written in the note's frontmatter, under `tg_ids`. That is hidden in Reading View, travels with the note, and is why two devices syncing one vault never produce duplicates. Nothing is written into the body except your message.

Capture is instant. **Delivery happens while Obsidian is open** — the plugin polls Telegram every thirty seconds by default, and there is no background execution on mobile. If Obsidian is closed, your message waits for you.

## Setup

1. Install the plugin and enable it.
2. In Telegram, message [@BotFather](https://t.me/botfather), send `/newbot`, follow the two prompts, copy the token it gives you.
3. Obsidian → Settings → Telegram Inbox → paste the token → **Connect**.
4. Send your new bot a message. That chat is now bound to the plugin.

That's it. Optionally set the folder, the note-name format, and the heading.

## Network use

The plugin talks to exactly one host, and only when you have configured a token:

- `https://api.telegram.org` — Telegram's Bot API, over HTTPS, through Obsidian's `requestUrl`.

It calls two methods: `getMe`, once, to check the token and learn the bot's name; and `getUpdates`, on a timer, to fetch messages sent to your bot. It never sends a message, never posts a reaction, never reads a chat the bot is not in.

There is no other network traffic. No telemetry, no analytics, no crash reporting, no remote configuration, no self-updating, no server of ours anywhere. The plugin has **zero runtime dependencies** — everything it needs is Obsidian's own API.

A future version will add optional voice transcription, which would call a second endpoint with an API key you provide. It is declared here now, before it exists, because that is what the catalogue's disclosure rule is for.

## Security and threat model

**What the plugin holds.** A bot token, stored in plain text in `data.json` inside your Obsidian config folder.

**What a stolen bot token gives an attacker.** Control of the *bot* — they can read messages people send to it, and post as it. That is all. It gives no access to your Telegram account: not your chats, not your contacts, not the ability to send messages as you, not the ability to log you out. A bot is a separate identity that you created for this purpose.

**Revoking it takes thirty seconds.** Send `/revoke` to @BotFather. The old token dies immediately. There is also a **Disconnect** button in the plugin, which removes the token from this vault but does not disable the bot elsewhere — use `/revoke` for that.

**If you sync your config folder.** Many people sync `.obsidian/` through git, iCloud, Syncthing or Obsidian Sync. Your bot token will go with it, into that repository, that cloud, those backups. Because a bot token is not an account credential, and because revoking it is trivial, the plugin does not make you invent a passphrase to protect it — that would be security theatre paid for on every launch. If your vault is public, add the plugin's `data.json` to `.gitignore`.

**Anyone who knows your bot's username can message it.** Bot usernames are guessable. So the plugin binds itself to the first chat that writes to it, and silently ignores every other chat. You can see and reset the binding in settings. Without this, a stranger could write into your daily note.

**What the plugin will never do.** Send messages, set reactions, read chats you did not point it at, collect telemetry, phone home, or update itself.

## What you should know before relying on it

- **Messages expire after 24 hours.** Telegram's Bot API queues undelivered updates for one day. If Obsidian is not opened for longer than that, those messages are gone from the queue — you would need to look for them in the chat with your bot. Account mode (v0.3) does not have this limit, because Telegram stores your account's history forever.
- **Text only, for now.** Photos, voice notes and documents are counted and skipped, and the plugin tells you it skipped them. Attachments arrive in v0.2.
- **One bot, one vault.** Telegram allows a single poller per bot. If your desktop and your phone are both open, one of them wins the poll and the other backs off; the note reaches the second device through your normal vault sync. This is handled, not an error.
- **Edited and deleted messages.** A message you edit in Telegram after it has synced stays as it was in your note. A message you delete in Telegram stays in your note. Both are deliberate: the note is yours.

## Development

```bash
npm install
npm test          # unit tests, no Obsidian runtime needed
npm run typecheck # strict
npm run build     # typecheck + lint + bundle to main.js
```

The build fails if any code imports a Node or Electron API — the plugin must run on mobile, so `isDesktopOnly` is `false` and those APIs are unavailable. It also fails if the product bundle imports GramJS, which belongs to the v0.3 account-mode work and is currently used only by the throwaway Phase 0 spike under `spikes/`.

Design decisions worth reading before changing anything:

- [`docs/ADR-001-bot-mode-first.md`](docs/ADR-001-bot-mode-first.md) — why bot mode ships before account mode
- [`docs/SPIKE-REPORT.md`](docs/SPIKE-REPORT.md) — what Phase 0 established, including a duplication bug the obvious implementation would have shipped
- [`docs/SECURITY-DECISION.md`](docs/SECURITY-DECISION.md) — how the account-mode session will be stored in v0.3
- [`docs/MANUAL-TEST-GUIDE.md`](docs/MANUAL-TEST-GUIDE.md) — the checks that need a human and a real phone

## Licence

MIT.

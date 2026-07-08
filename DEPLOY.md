# Task for the agent: build and install the plugin into Obsidian

You have filesystem access to this machine. The goal is that Obsidian runs the current source of this repository. Nothing here needs network access.

Repository: `/Users/nickeo23/code_projects/telegram_obsidian_bridge`
Plugin id: `vault-telegram-bridge` (this is the folder name inside the vault — not the display name)

Report back the built file size, the destination path, and the plugin version you installed.

## 1. Build

```bash
cd /Users/nickeo23/code_projects/telegram_obsidian_bridge
npm install          # only if node_modules is missing
npm run build        # typecheck → lint → esbuild → main.js
```

`npm run build` prints the bundle size on success, e.g. `main.js: 25.2 KB minified`. It writes `main.js` into the repository root.

**Do not skip the build and copy the existing `main.js`.** It is a build artifact listed in `.gitignore`, so whatever is sitting there may predate the current source. That exact mistake is why this file exists. If you want to be certain, check that `main.js` is newer than everything in `src/`:

```bash
find src -newer main.js -name '*.ts'   # must print nothing
```

If `npm run build` fails with `You installed esbuild for another platform`, `node_modules` was populated on a different OS. Delete it and reinstall:

```bash
rm -rf node_modules package-lock.json && npm install
```

(`package-lock.json` is regenerated; that is expected and fine.)

## 2. Find the vault

Ask the user which vault, unless there is exactly one obvious candidate. A vault root is a directory containing `.obsidian/`. To find them:

```bash
find ~ -maxdepth 5 -type d -name '.obsidian' -not -path '*/node_modules/*' 2>/dev/null
```

Obsidian also keeps a list of open vaults at
`~/Library/Application Support/obsidian/obsidian.json` — the `vaults` object maps ids to `{ path, ts, open }`. That is the reliable source. Read it rather than guessing.

Do not use this repository as the vault. It is not one.

## 3. Install

```bash
node scripts/install-to-vault.mjs "/path/to/vault"
```

It creates `<vault>/.obsidian/plugins/vault-telegram-bridge/` and copies `main.js`, `manifest.json` and `styles.css`. It refuses to write to a path with no `.obsidian/` directory, which is the only guard against scattering plugin files across a home directory.

`--build` makes it run `npm run build` first, so step 1 and step 3 can be one command:

```bash
node scripts/install-to-vault.mjs "/path/to/vault" --build
```

Doing it by hand is three files and no magic:

```bash
mkdir -p "/path/to/vault/.obsidian/plugins/vault-telegram-bridge"
cp main.js manifest.json styles.css "/path/to/vault/.obsidian/plugins/vault-telegram-bridge/"
```

## 4. Make Obsidian pick it up

Obsidian loads `main.js` once, at plugin enable, and holds it in memory. Copying a new file over it changes nothing until the plugin is reloaded. **The user has to do this part** — there is no reliable way to do it from the filesystem:

> Settings → Community plugins → toggle **Telegram Inbox** off, then on.

Reloading the whole app (`Cmd+R`) also works. Tell the user which one you want; do not report success without saying this out loud, because "I copied the file and nothing changed" is the failure this whole document is about.

If the plugin has never been enabled: Settings → Community plugins → Installed plugins → enable **Telegram Inbox**. Community plugins must be turned on (Restricted mode off) for it to appear.

## 5. Verify

The build should be current, so this is cheap:

```bash
V="/path/to/vault/.obsidian/plugins/vault-telegram-bridge"
cmp main.js "$V/main.js" && echo "main.js matches"
cmp manifest.json "$V/manifest.json" && echo "manifest matches"
grep -o '"version": *"[^"]*"' "$V/manifest.json"
```

Then, in Obsidian, the plugin's settings tab must show a section titled **How each message looks**, with a *Line format* text field, a *Wrap each message in* dropdown (Nothing / A code block / A callout), and a live *Preview*. If that section is absent, the old `main.js` is still loaded — go back to step 4.

## What the user should see after a successful update

Messages appended to the day's note look like this, with the default settings:

```markdown
## Telegram

**15:29** an idea

**15:30** another one
```

and the note's frontmatter grows a `tg_ids` list. No `%%tg:…%%` comments in the body any more — those were the old format. Existing notes that still contain them are recognised and will not be re-synced; leave them alone.

## Things to not do

- Do not edit `main.js`. It is generated. Change `src/` and rebuild.
- Do not copy `node_modules`, `src/`, `docs/`, or the repo itself into the vault. Two files.
- Do not run `npm test` as a gate before installing — it is useful, but `vitest` is unrelated to whether the bundle is correct, and a failing test should be reported rather than silently blocking the install.
- Do not touch anything else under `.obsidian/`. In particular, `plugins/vault-telegram-bridge/data.json` holds the user's bot token and sync cursor. Overwriting or deleting it disconnects the bot and re-syncs, or loses, messages.

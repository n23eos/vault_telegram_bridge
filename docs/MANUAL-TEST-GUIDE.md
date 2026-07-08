# Manual verification guide — Phase 0

Everything in `SPIKE-REPORT.md` that says *requires manual verification* is verified here. It takes about 40 minutes. The desktop pass answers most questions; the Android pass is the one that can still turn the project around, so do not skip it.

Results paste directly into the marked sections of `SPIKE-REPORT.md`.

## Before you start

**Use a throwaway Telegram account if you can.** The spike stores its `api_id` in plain text in the spike's own `data.json`, and you are about to log a session into experimental code. If a throwaway account is not practical, use your real one and delete the session afterwards — step 6 tells you how.

Get an `api_id` / `api_hash` pair at <https://my.telegram.org> → API development tools. Any values for app title and short name.

`.gitignore` already excludes the session file and `spike-credentials.json`. It does **not** exclude the spike plugin's `data.json`, because that file lives in your vault, not in this repository. Do not paste your credentials into a file here.

## Build and install

```bash
npm install
npm test          # 48 tests, all should pass — see report note if vitest crashes
npm run typecheck # strict, should be silent
npm run spike:build
```

`spike:build` prints the bundle size and greps the output for Node and Electron APIs. Both go in the report.

Copy `main.js` and `manifest.json` into a **scratch vault** at `<scratch-vault>/.obsidian/plugins/vault-telegram-bridge-spike/`. Not your real vault. Enable it under Settings → Community plugins, then open its settings tab and paste your `api_id` and `api_hash`.

---

## 1 — Spike 0.1, desktop (macOS)

Open the developer console first: `Cmd+Opt+I`. Everything the spike measures is logged there and mirrored into the settings tab.

Click **Spike 0.1 → Run**. Enter your phone (`+7…` / `+1…`), then the login code Telegram sends *inside the Telegram app*, then your 2FA password if you have one (leave blank if not).

Record from the log:

- [ ] `gramjs dynamic import + evaluate: ___ ms` — the report projects **51 ms** on a desktop core
- [ ] `TelegramClient construct: ___ ms`
- [ ] `login round-trip: ___ s`
- [ ] `getMessages('me', limit 1): ___ ms`, `got 1`
- [ ] `JS heap delta: ___ MB`

Then the question no static analysis can answer:

- [ ] Did login complete at all? If Telegram sent an extra confirmation code because the IP is new, note it — SPEC §11 predicts this and the FAQ needs to describe it.

**Background behaviour.** Re-run the spike, and while it is connected, minimise Obsidian for five minutes. Come back and click **Run** again.

- [ ] Did the second run reconnect cleanly, or did it hang or throw?
- [ ] Anything in the console about `Automatic reconnection failed`?

This is finding 0.1-F7's open question 2, and its answer decides whether Phase 1's sync engine needs an explicit reconnect-on-resume path.

---

## 2 — Spike 0.1, real Android

**The one that matters.** Older device is better; a 2019 mid-range phone is the target, not a flagship. If it works there it works everywhere.

Copy the same two files into a vault on the phone (Obsidian Sync, or a USB copy into the vault's `.obsidian/plugins/…`). Enable the plugin.

There is no console. The settings tab keeps the log, and **Copy log** puts it on the clipboard — send it to yourself in Telegram, which is fitting.

- [ ] Does the plugin enable without freezing the app?
- [ ] Does **Spike 0.1 → Run** complete a login?
- [ ] `gramjs dynamic import + evaluate: ___ ms` — the report projects **150–300 ms**. A number far above that is a finding.
- [ ] `login round-trip: ___ s`
- [ ] `JS heap delta:` — expect "performance.memory unavailable" on some builds; that is fine, note it.

**If login fails on Android, capture the exact error before anything else.** The failure mode the report cares about is the WebView refusing `wss://vesta.web.telegram.org/apiws` — a CSP violation, a `SecurityError`, or a socket that never opens. That is the surviving NO-GO for account mode on mobile (0.1-F3, 0.1-F7). Anything else is probably a bug in the spike, not in the architecture.

Then background the app for five minutes and click **Run** again, as on desktop. Mobile WebViews suspend timers and sockets far more aggressively than Electron.

- [ ] Reconnect after background: clean / hangs / throws `______`

---

## 3 — Spike 0.1, iOS

Same procedure. iOS is WebKit, not Chromium, and its WebView is stricter about background execution.

- [ ] Login completes
- [ ] Reconnect after background
- [ ] Note that `performance.memory` is absent (expected — WebKit does not implement it)

If you have no iOS device, say so in the report rather than leaving the boxes blank. An untested platform documented as untested is fine. An untested platform that looks tested is not.

---

## 4 — Spike 0.2, the render check

Click **Spike 0.2 → Create**. It writes `TG-SPIKE-dedupe-render-test.md` to the vault root.

Open the note and step through **Reading View**, **Live Preview** and **Source mode**. Then File → Export to PDF.

For each section, the expected result and the thing it decides:

| § | Expect | If it does not |
|---|---|---|
| **A** inline `%%…%%` on list items | Marker invisible in Reading View and Live Preview; bullets, checkboxes, tags, links and wikilinks all render normally | Inline placement is dead; fall back to C |
| **B** `%%…%%` on its own line in a list | The list **breaks** into two lists, or a paragraph gap appears | If B renders fine, note it — it would give us a cleaner format than A |
| **C** inline `<!-- … -->` | Marker invisible, list intact | Both candidates are dead; escalate |
| **D** multi-line, indented continuation | One bullet containing three lines, one marker | Continuation lines are wrong; the two-space indent needs revisiting |
| **E** hostile bodies | All three lines show their **full text** — `100%% off`, `a --> b`, `<!-- oops` | The sanitiser is insufficient. Stop and re-open 0.2-F2 |
| **F** unsanitised control | This line **should break**: text after `%%` vanishes, marker 14 swallowed | If F renders fine, `%%` does not open a comment inline and the sanitiser is unnecessary. Delete it |
| **G** appended under existing content | Reads naturally beneath hand-written text | — |

Section F is the important one and the counter-intuitive one. It is there to falsify the sanitiser's reason for existing. A passing F means we wrote defensive code against a hazard that is not real, and that code should be removed rather than kept "just in case".

Now the **PDF export**. Look at sections A and C:

- [ ] Are the `%%` markers absent from the PDF? Are the `<!-- -->` markers absent?
- [ ] Does either style leave a visible artefact, a gap, or a stray character?

And the portability question from 0.2-F4, which the PDF only hints at. If any part of your vault is ever rendered outside Obsidian — GitHub, Obsidian Publish, a static-site generator, `git diff` in a review — check what `%%tg:777000:1%%` looks like there. In GitHub's Markdown renderer it appears as literal text. `<!-- tg:777000:1 -->` does not. Decide whether that matters to you; it is the only real argument against the recommended format.

- [ ] Verdict: **`%%…%%`** / **`<!-- … -->`** → write it into `SPIKE-REPORT.md` §0.2 and into the contract in TZ §4.

Delete the fixture note when you are done. It is tagged `throwaway`.

---

## 5 — Spike 0.3, on-device key derivation

Click **Spike 0.3 → Run**, on desktop and on the slowest device you have.

- [ ] `PBKDF2 600000: median ___ ms` — desktop reference is **47 ms**
- [ ] `calibrated: ___ iters @ ___ ms, within budget: true`
- [ ] `roundtrip identical: true`
- [ ] `wrong passphrase rejected: true`
- [ ] `iv unique: true, salt unique: true, ct differs: true`
- [ ] `wrote …/telegram-session.json.enc via Vault.adapter` followed by `wiped session file`

If `within budget` is ever `false`, the device needed more than two seconds even at the 210 000 floor. Record the device and the number; `SECURITY-DECISION.md` would need a paragraph, and the wizard a warning.

The last two lines matter as much as the timings: they prove a file can be written and deleted under `configDir` through `Vault.adapter` on mobile, with no `fs`.

---

## 6 — Clean up

- [ ] Obsidian → Settings → Community plugins → disable and remove the spike plugin from every device you installed it on.
- [ ] **Telegram → Settings → Devices** → find the session the spike created and terminate it. Do this even if you used a throwaway account. Note what the session is called in that list — Phase 1 has to set `deviceModel` to something a user can recognise, and `os.hostname()` is not available to us (0.4-F1).
- [ ] Delete the scratch vault, or at least `.obsidian/plugins/vault-telegram-bridge-spike/data.json`, which contains your `api_id` and `api_hash`.
- [ ] Delete `TG-SPIKE-dedupe-render-test.md`.

---

## 7 — Write it up

Paste the numbers into the marked places in `SPIKE-REPORT.md`, and state a verdict for 0.1 and 0.2 in the table at the top: **GO**, **NO-GO**, or **GO with reservations** naming the reservation.

Then the gate in TZ §3: **Phase 1 does not start until you give the GO.**

If Android login failed at the WebSocket, do not start Phase 1 at all. Re-open SPEC §0 and §12 first — bot mode becomes the primary mode, the comparison table against Telegram Sync collapses to "wizard, mobile, RU", and the positioning needs rewriting before any more code is written. That is a bad afternoon, and it is much cheaper than finding out in week six.

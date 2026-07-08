# Phase 0 spike report

Date: 2026-07-08 · Scope: TZ §3 · Product code written: none

**Overall verdict: GO with reservations.** No spike returned a NO-GO. One finding (0.1-F1) would have cost days if it had surfaced in Phase 1, one (0.4-F2) changes the recommended onboarding flow, and one (0.2-F2) is a correctness bug that the obvious implementation would have shipped.

Three things still need a human. They are listed in [Open items](#open-items) and none of them blocks starting Phase 1 on the modules that do not touch the network.

| Spike | Verdict | Blocking issue |
|---|---|---|
| 0.1 gramjs in Obsidian | GO with reservations | Needs a real Android/iOS run (F7) |
| 0.2 dedupe marker | GO with reservations | Needs a visual render check (F4) |
| 0.3 session encryption | **GO** | none |
| 0.4 api_id and catalogue policy | GO with reservations | Needs the Discord answer; api_id choice is the user's |

Measurements below were taken on the agent's Linux sandbox (arm64, Node 22 / V8, 4 cores), not inside Obsidian. They bound the problem; they do not close it. Every number that needs a device is marked.

---

## 0.1 — gramjs inside Obsidian

### F1 — `telegram@latest` does not build for the browser. Use the `browser` dist-tag. (critical)

The `telegram` package publishes two builds under one name. `latest` (2.26.22) is the Node build. Bundling it with `platform: browser` fails outright:

```
✘ Could not resolve "util"    node_modules/telegram/inspect.js
✘ Could not resolve "path"    node_modules/telegram/client/path.js
✘ Could not resolve "path"    node_modules/node-localstorage/LocalStorage.js
✘ Could not resolve "fs"      node_modules/node-localstorage/LocalStorage.js
✘ Could not resolve "events"  node_modules/node-localstorage/LocalStorage.js
```

`telegram@browser` (2.26.21) drops `node-localstorage` and `socks` from its dependency list and bundles clean. The two builds share a version series, so **`telegram@^2.26.0` in `package.json` is a trap**: a routine `npm update` silently swaps the browser build for the Node build and the plugin stops building for mobile. The version is pinned exactly, and the reason is written next to it in `package.json`.

This alone justified spike 0.1. It is invisible from the docs.

### F2 — Bundle size: 722 KB minified, 203 KB gzipped

Dominant inputs:

| Input | Bytes in bundle |
|---|---|
| `telegram/tl/apiTl.js` (the TL schema) | 230 960 |
| `entities/lib/maps/entities.json` | 35 770 |
| `mime/types/other.js` | 25 909 |
| `buffer/index.js` | 25 297 |
| `big-integer/BigInteger.js` | 21 672 |
| `pako` (deflate + inflate) | 29 613 |

Inside SPEC §11's "1–2 MB is acceptable on desktop". `mime` and `htmlparser2` (~50 KB together) are pulled in by GramJS's file-upload and HTML-entity paths, neither of which the MVP uses; they are not tree-shakeable because GramJS's barrel export reaches them. Not worth fighting in Phase 1.

### F3 — In browser mode GramJS talks to `wss://<dc>.web.telegram.org/apiws`, not to raw MTProto TCP

`telegram/platform.js`:

```js
exports.isBrowser = !isDeno && typeof window !== "undefined";
exports.isNode    = !exports.isBrowser;
```

and `telegram/client/telegramBaseClient.js`:

```js
const DEFAULT_IPV4_IP = isNode ? "149.154.167.91" : "vesta.web.telegram.org";
connection:    isNode ? ConnectionTCPFull    : ConnectionTCPObfuscated,
networkSocket: isNode ? PromisedNetSockets   : PromisedWebSockets,
```

`window` exists in the Electron renderer *and* in Obsidian mobile's WebView, so both platforms take the browser branch. Three consequences:

1. **README "Network use" must name `*.web.telegram.org`**, not "Telegram servers" in the abstract. This is the same gateway that `web.telegram.org` itself uses.
2. **Mobile stays viable.** No raw TCP socket is ever opened, which is what would have forced `isDesktopOnly: true`.
3. **New risk, not in SPEC:** in a country where the Telegram *app* works but the web gateway is blocked, account mode fails and bot mode does not. Goes in the FAQ and strengthens the case for bot mode as a genuine fallback rather than a checkbox.

The prior-art plugin sets `useWSS: true, networkSocket: PromisedWebSockets` explicitly rather than relying on this detection (0.4-F1). We should do the same: the detection is one `typeof window` away from breaking.

### F4 — Zero Node/Electron API in the built bundle

`npm run spike:build` greps the output for eleven patterns. All zero:

```
require("fs") require("path") require("child_process") require("electron")
require("os") require("net") require("tls") require("crypto")
safeStorage   __dirname       process.env
```

There is no reference to `process` at all. The check is not a one-off: `esbuild.config.mjs` installs a `forbid-node-builtins` resolver plugin that turns any import of a Node builtin into a build error naming TZ §1, so a Phase-1 regression fails CI rather than mobile.

### F5 — Required browser globals, and one that crashes at module evaluation

Loading the bundle in a VM with no `location` throws before any of our code runs:

```
TypeError: Cannot read properties of undefined (reading 'protocol')
```

The full set GramJS touches: `window`, `location.protocol`, `navigator`, `document`, `localStorage`, `WebSocket`, `crypto.subtle`. All are present in the Electron renderer and in the Capacitor WebView, so this is not a blocker — but it means GramJS cannot be evaluated in a worker or any non-DOM context, which forecloses "run the sync in a Web Worker to keep the UI responsive" as a future optimisation.

### F6 — GramJS writes to Obsidian's `localStorage`

`telegram/tl/api.js` caches the parsed TL schema under the key `GramJs:apiCache`:

```js
const CACHE_KEY = "GramJs:apiCache";
const CACHING_SUPPORTED = typeof self !== "undefined" && self.localStorage !== undefined;
```

Not dangerous, but it is third-party state in the host app's storage that outlives plugin removal. Two actions for Phase 1: mention it in the README's data section, and delete the key in `wipe()` and `onunload` so "remove the plugin" leaves nothing behind. This is precisely the sort of thing the self-critique checklist asks about.

### F7 — Load cost, and why the plugin must import GramJS lazily

Measured on the built spike bundle, loaded into a browser-shaped VM (no `require`, no `process`):

| Step | Desktop-class core | Naive projection, old Android (×3–6) |
|---|---|---|
| Parse + compile 722 KB | 5.6 ms | 20–35 ms |
| Top-level evaluate, GramJS **lazily** imported | **0.4 ms** | 1–3 ms |
| GramJS module evaluate (first `connect()` only) | 51 ms | 150–300 ms |
| `new TelegramClient(...)` | 0.4 ms | ~2 ms |
| JS heap after evaluate | ≈ 19.5 MB | unknown; WebView differs |

The 0.4 ms figure is the whole finding. With `await import('telegram')` behind the connect action, esbuild keeps GramJS in a module factory that never runs until called, so **a user who installs the plugin and never connects Telegram pays 6 ms at startup, not 57 ms** — and the 51 ms is paid once, on a screen where the user is already waiting for a network round-trip. Phase 1 must not hoist that import to the top of `main.ts`; the whole onload budget depends on it.

These numbers are from V8 in a VM, not from Obsidian. The heap figure in particular is meaningless for iOS/WebKit. **Requires manual verification** (see the guide).

### 0.1 verdict — GO with reservations

Everything checkable without a phone checked out: it bundles, it has no Node dependencies, it constructs a client, and it costs nothing at startup if imported lazily. What no static analysis can answer, and what the run on real hardware must answer:

1. Does a login actually complete inside Obsidian mobile, or does the WebView's CSP block `wss://*.web.telegram.org`?
2. What happens to the WebSocket when the app is backgrounded, and does GramJS's reconnect recover cleanly on resume, or does it wedge?
3. Real memory on an old Android device.

If (1) fails, account mode is desktop-only and the SPEC §12 comparison table collapses. That is the surviving NO-GO scenario, and it is one afternoon of a real phone away.

---

## 0.2 — Dedupe marker

### F1 — A standalone `%%` line cannot be used inside a list

`%%` alone on a line opens an Obsidian block comment. Placing the marker on its own line inside a list breaks the list into two lists. Placement is therefore **inline, at the end of the item's first line**, and this is not a preference — it is forced.

### F2 — User text can swallow the marker. The obvious implementation is broken. (correctness bug)

Message bodies are whatever the user typed into Telegram. A body containing `%%` opens a comment that runs to the end of the line, consuming our marker:

```markdown
- 09:55 unsanitised %% double percent %%tg:777000:14%%
                    ^^ opens a comment ... which eats the marker
```

Two things break at once, and the second is worse than the first. The text after `%%` disappears from Reading View, and `extractMarkers()` no longer finds the message — so **every subsequent sync re-appends it**. A user who sends "50%% off" gets an infinitely growing daily note. The HTML-comment variant has the identical bug via `-->`.

`sanitizeBody()` inserts U+200B between the offending characters. Nothing is deleted, the rendered text is visually identical, and the comment never opens. It is written with lookahead rather than literal replacement so that `%%%` and repeated application both behave (`sanitizeBody(sanitizeBody(x)) === sanitizeBody(x)`, tested).

A related hole, closed the same way: `markerFor()` validates `chatId` against `/^-?\d+$/`, because a chat id carrying `%%tg:1:1%%` would otherwise let a message forge another message's marker.

### F3 — `extractMarkers()` reads both formats, writes one

If the render check (F4) sends us to HTML comments in v0.2, notes written by v0.1 must still be recognised, or the first sync after the upgrade re-appends the user's entire history. The extractor accepts `%%tg:a:b%%` and `<!-- tg:a:b -->`; the writer emits one style. Costs nothing now, unrecoverable later.

The extractor is also stateless across calls, despite the module-level `RegExp` objects with the `g` flag — `lastIndex` is reset explicitly. There is a test for it, because this is the classic way that bug ships.

### F4 — The render matrix needs eyes. **Requires manual verification.**

Reading View, Live Preview, Source mode and PDF export cannot be checked from here. `spikes/src/dedupe-fixture.ts` generates a note covering every placement, including hostile bodies and one deliberately unsanitised control line that should visibly break — if it does not break, the sanitiser is solving a problem that does not exist and should be removed.

Preliminary recommendation, pending that check: **`%%tg:<chatId>:<messageId>%%`, inline, appended to the first line after a single space.**

One argument for the HTML-comment variant deserves to be weighed rather than dismissed. `%%` is Obsidian-specific: it is hidden in Obsidian and shows up as literal noise in a GitHub-rendered vault, a `git diff`, a static-site export, or any other Markdown tool. `<!-- -->` is hidden everywhere. Against that, `%%` is idiomatic Obsidian and the plugin's audience is Obsidian users. The fixture note is designed to make this trade-off visible in the PDF-export step, and the decision is the user's.

### 0.2 verdict — GO with reservations

Format and placement are settled modulo the visual check. The escaping hazard was the real output of this spike: it is not mentioned in SPEC or TZ, and the natural implementation of `- {time} {text} {marker}` ships an infinite-duplication bug on the first message containing `%%`. 27 unit tests cover it.

---

## 0.3 — Session encryption

Full scheme, rejected alternatives and threat model: **[SECURITY-DECISION.md](SECURITY-DECISION.md)**. Only the measurements are here.

### F1 — PBKDF2-HMAC-SHA256 is nowhere near the 2 s budget

WebCrypto, median of three, after warm-up:

| Iterations | Median |
|---|---|
| 100 000 | 7.9 ms |
| 210 000 | 16.5 ms |
| 310 000 | 23.5 ms |
| **600 000** | **47.1 ms** |
| 1 000 000 | 78.7 ms |

TZ §0.3 anticipated having to *lower* the OWASP-recommended 600 000 for mobile. On this hardware the recommendation costs 47 ms, and even a 20× slower device stays under a second. `crypto.subtle` PBKDF2 is native code (BoringSSL/CommonCrypto) in every WebView we care about, not JS, so the mobile ratio should be closer to CPU-clock ratio than to JS-benchmark ratio.

We keep 600 000, and `calibrateIterations()` steps down the ladder 600k → 310k → 210k only if a device measures over the 2 s budget. The chosen count is stored in the file, so a step-down never locks anyone out of a file written on a faster machine. **The on-device number still wants confirming**, but no plausible result changes the design.

### F2 — Roundtrip, tamper-evidence and file shape all hold

21 tests. The interesting ones are not the happy path:

- Encrypting the same session twice with the same passphrase yields different `salt`, `iv` and `ct`.
- A wrong passphrase, a flipped ciphertext bit, a tampered IV and a downgraded `iters` all fail at the GCM tag, before any plaintext exists.
- The serialised file contains neither the plaintext nor the passphrase nor any 16-character prefix of them.
- Seven malformed file shapes are rejected with `CorruptSessionFileError` rather than being coerced.

Encrypted file: 634 bytes on disk for a 377-character session string.

### F3 — Written through `Vault.adapter`, into `vault.configDir`

The spike writes and then deletes `<configDir>/plugins/<id>/telegram-session.json.enc` via `this.app.vault.adapter`, with the path built from `this.app.vault.configDir` and passed through `normalizePath()`. No `fs`. The literal string `.obsidian` appears nowhere in the codebase.

### 0.3 verdict — GO

No reservations. The scheme, the file format and the failure modes are fixed and can be lifted into `src/telegram/session-store.ts` in Phase 1 essentially as they stand.

---

## 0.4 — api_id and catalogue policy

### F1 — MTProto user login has already passed Obsidian's review, and the precedent is more interesting than "yes"

`obsidian-telegram-sync` (663 stars) is in the official community catalogue and depends on `telegram` (GramJS) 2.25. Its `src/telegram/user/client.ts` authenticates a **user account**, not just a bot. So the answer to SPEC §0.2 — "is a full MTProto login flow acceptable in a catalogue plugin?" — is evidently yes, at least once, at least for that reviewer.

Three details of *how* it does it matter more than the fact that it does.

**It logs in by QR code, not by phone number.** It calls GramJS's `signInUserWithQrCode`, renders a `tg://login?token=…` QR, and the user authorises it by scanning with the Telegram app already on their phone. No phone number is typed into the plugin. No SMS code is typed into the plugin. See 0.4-F2.

**It hits `API_ID_PUBLISHED_FLOOD` often enough to special-case it.** From `src/telegram/user/user.ts`:

```ts
if (!error.message.includes("API_ID_PUBLISHED_FLOOD")) { /* surface the error */ }
```

That is Telegram's error for an api_id that has been published and is being used by many parties — exactly the "shared api_id" hazard in SPEC §4, observed in production, in this exact product category. It is swallowed silently there. It is the strongest single piece of evidence we have, and it is not a ban: it is throttling. The plugin also stores its api_id under reversed identifiers (`config.dIipa` / `config.hsaHipa`) — a pattern Obsidian's no-obfuscation rule exists to discourage, and one we will not use.

**It is desktop-only because of Node imports, not because of MTProto.** `import os from "os"` for `deviceModel: os.hostname()`, plus `node-telegram-bot-api` and `node-machine-id`. Our F3/F4 findings say the MTProto path itself is mobile-clean. The competitor's "would never be available on mobile" is a consequence of implementation choices we are not making — which is the whole SPEC §12 thesis, and it now has evidence behind it rather than hope.

> **Licence hazard.** `obsidian-telegram-sync` is AGPL-3.0. The facts above were read from its source; no code, structure or naming was taken, and none may be. TZ §7 already forbids a fork. Phase 1 authors should treat that repository as off-limits and work from the GramJS documentation. If in doubt, do not open it.

### F2 — QR login is available in GramJS, and it dissolves SPEC's central onboarding fear

SPEC §1 states the problem precisely: *"для продвинутых пользователей «ввести номер телефона и код в сторонний плагин» страшнее, чем BotFather-токен"*. SPEC §4 then accepts that cost and spends the whole wizard trying to talk the user down from it.

`client.signInUserWithQrCode({ apiId, apiHash }, { qrCode, password, onError })` removes the cost instead of arguing about it. The user sees a QR code, opens Telegram → Settings → Devices → Link Desktop Device, and scans. The plugin never sees a phone number or a login code. The 2FA cloud password is still required if enabled, and is still used once and discarded.

This is a recommendation, not a spike verdict, and it is outside Phase 0's mandate — but it is squarely a Phase-0 finding, because TZ §5.3 currently specifies `Phone → Code → 2FA` as wizard steps 3 and the interface contract in TZ §4 encodes `phone()` and `code()` as required callbacks. Suggested change to `LoginFlowCallbacks`, to be made before `types.ts` is frozen:

```ts
export interface LoginFlowCallbacks {
  showQrCode(url: string): void;          // primary: tg://login?token=...
  phone(): Promise<string>;               // fallback path
  code(): Promise<string>;                // fallback path
  password(): Promise<string>;            // 2FA, never stored
  onError(e: HumanError): void;
}
```

On mobile the QR is awkward — the phone showing the code is the phone that must scan it — so the phone/code path stays as a fallback there, and `tg://login?token=` can be opened as a deeplink instead. Worth a spike of its own in Phase 1.

### F3 — Ecosystem signals on ban risk: real, unquantified, and pointed at the user

- Telethon, the reference MTProto library, was **archived by its author on 2026-02-21**. Its FAQ states that anti-spam measures have grown more aggressive since 2023, recommends using only well-established accounts, and notes that VoIP numbers and numbers from certain countries are disproportionately banned.
- `API_ID_PUBLISHED_FLOOD` (F1) confirms Telegram actively identifies and throttles published api_ids.
- No evidence was found of a *ban wave* specifically targeting note-taking plugins, and no evidence was found that a bundled api_id causes bans as opposed to throttling. The honest summary is: the risk is real, the magnitude is unknown, and it lands on the user's primary account rather than on us.

F3 (the WSS gateway) shifts this picture slightly in our favour: our traffic reaches Telegram through the same web gateway their own web client uses, which is a less unusual fingerprint than a raw TCP MTProto session from a residential IP.

**Recommendation, for the user to accept or reject:** ship a bundled api_id, and present "use my own api_id" in the wizard as a peer option — same visual weight, one screen, not buried behind an "Advanced" disclosure — with one honest sentence about throttling and account risk. Inverting the default (own api_id required) is the safer choice for the user and, per SPEC §8's mass-audience requirement, the one that costs the most installs. This is a product call, not a technical one, and it is yours.

### 0.4 verdict — GO with reservations

The catalogue question is effectively answered by precedent. The api_id question is a risk-allocation decision that belongs to you, and the Discord thread should confirm both before Phase 1 writes a wizard.

---

## Open items

Nothing below blocks Phase 1 work on `sync/`, `vault/`, `settings.ts`, `i18n/` or `errors.ts` — TZ §7's Track B — which can begin against a `FakeTelegramClient` as soon as `types.ts` is frozen.

**Requires a real device (you).** `docs/MANUAL-TEST-GUIDE.md` has the procedure, the spike plugin has the buttons, and the results paste straight into this file.

1. **0.1 on desktop, a real Android (older the better), and iOS.** Does login complete? Does the socket survive backgrounding? What are the real onload and memory numbers? — *This is the only remaining path to a NO-GO.*
2. **0.2 render check.** Open the fixture note in all three view modes and export to PDF. Confirm placement A works, placement B breaks, hostile bodies survive, and the unsanitised control line breaks as predicted.
3. **0.3 on-device KDF timing.** Expected to be uneventful.

**Requires a decision (you).**

4. **api_id: bundled with a disclaimer, or the user's own?** (0.4-F3)
5. **QR login as the primary flow?** If yes, `LoginFlowCallbacks` in TZ §4 changes before it is frozen. (0.4-F2)
6. **`%%` vs `<!-- -->`,** if the PDF/portability trade-off in 0.2-F4 matters to you.

**Requires sending (drafts ready).**

7. The #plugin-dev Discord question.

## Notes on how this was verified

The spike bundle was loaded into a `node:vm` context supplying only browser globals — no `require`, no `process`, no `fs` — which is the closest available proxy for the Capacitor WebView and is how F4, F5 and F7 were established. The `require` hook in that harness throws on anything except `obsidian`, so a Node import would have surfaced as a hard failure rather than a silent fallback.

`vitest` is the committed test runner per TZ §1, and `npm test` is what CI should run. It could not execute in the agent's sandbox: its bundled `@rollup/rollup-linux-arm64-gnu` native binary segfaults there (`Bus error (core dumped)`), unrelated to any code in this repository. The 48 tests were instead compiled with esbuild and executed under `node --test` against a minimal `expect` shim; all 48 pass. **Please confirm `npm test` runs clean on your machine** before treating the counts in this report as verified. `npm run typecheck` passes with `strict: true` and no suppressions.

# Security decision: how the Telegram session is stored

Status: **decided**, Phase 0. Supersedes nothing. Changing any of this after Phase 1 ships is a breaking change and needs a `v: 2` file format.

Required reading before writing product code (TZ §0.3, SPEC §4).

## What we are protecting

A GramJS `StringSession` is a bearer credential for the whole Telegram account. Whoever holds it can read every chat, send messages as the user, and terminate the user's other sessions. It does not expire on its own. There is exactly one revocation path that works without the string itself: Telegram → Settings → Devices → terminate.

So the asset is a ~350-character string, and the realistic way it escapes is not an attacker on the machine — it is the user's own backup, sync and version-control tooling. A large share of the target audience syncs the vault, including `.obsidian/`, through Obsidian Sync, iCloud, Syncthing, Dropbox or git. "Vault pushed to a public GitHub repo" is a routine event, not a thought experiment.

## The decision

The session string is encrypted with a key derived from a user-supplied passphrase and written to a single file inside the plugin's own config directory.

Scheme:

```
key        = PBKDF2-HMAC-SHA256(passphrase, salt, iters) -> 256 bit, non-extractable
ciphertext = AES-256-GCM(key, iv, session_string)
```

| Parameter | Value | Why |
|---|---|---|
| KDF | PBKDF2-HMAC-SHA256 | The only password-based KDF in WebCrypto. Argon2/scrypt would mean a third-party crypto dependency, which TZ §1 forbids. |
| Iterations | 600 000 default, 210 000 floor | OWASP's 2023 figure for PBKDF2-HMAC-SHA256. Measured at 47 ms on a desktop core (`docs/SPIKE-REPORT.md` 0.3-F1) — far inside the 2 s budget, so there is no reason to go below the recommendation on capable hardware. |
| Salt | 16 random bytes, fresh per write | Defeats precomputation across users and across writes. |
| Cipher | AES-256-GCM | Authenticated. A wrong passphrase and a tampered file both fail closed, at the tag check, before any plaintext is produced. |
| IV | 12 random bytes, fresh per write | GCM catastrophically fails on IV reuse under the same key. Never derived, never counted, always `crypto.getRandomValues`. |
| Key extractable | `false` | The derived key cannot be exported out of WebCrypto, even by our own code. |

File: `<vault.configDir>/plugins/vault-telegram-bridge/telegram-session.json.enc`

```json
{
  "v": 1,
  "kdf": "PBKDF2-SHA256",
  "iters": 600000,
  "salt": "<base64, 16 bytes>",
  "iv":   "<base64, 12 bytes>",
  "ct":   "<base64, ciphertext || GCM tag>"
}
```

`configDir` is read from `this.app.vault.configDir` and never spelled `.obsidian`; the path goes through `normalizePath()`; the write goes through `Vault.adapter`, which works on mobile. No `fs`, no `node:crypto`, no `safeStorage`.

### Why `iters` lives in the file

A phone that needs 4 seconds for 600 000 iterations should be allowed to use fewer. If the iteration count were a constant in the source, lowering that constant in v0.2 would silently lock every existing user out of their own session file. Storing it makes the file self-describing.

Storing it does not weaken anything. `iters` is an input to the key derivation, so editing it changes the key, so the GCM tag fails. An attacker cannot downgrade the KDF by editing the JSON — they can only corrupt the file. There is a unit test for exactly this (`detects a tampered iteration count`).

### Passphrase handling

The passphrase is held in a local variable for the duration of one encrypt or decrypt call and then goes out of scope. It is never written to `data.json`, never placed in a settings field, never logged, never passed to Telegram. The 2FA cloud password is treated the same way and is used exactly once, during login.

There is no "remember my passphrase" option. Adding one would reduce the scheme to obfuscation.

## What this does not protect against

Say it plainly, in the README, before someone else says it for us.

- **A keylogger or malware already running as the user.** It reads the passphrase as it is typed. Nothing a plugin can do about this.
- **A weak passphrase.** PBKDF2 at 600 000 iterations raises the cost per guess by roughly six orders of magnitude over a bare hash. Against `password123` that is still not enough. The wizard enforces a floor of 8 characters, which is a speed bump, not a defence. This is stated honestly at the passphrase step.
- **Another Obsidian plugin.** Community plugins share a JS realm and can read each other's files. A malicious plugin can hook `crypto.subtle` and capture the derived key at the moment of use. Obsidian's plugin model has no isolation; our encryption is orthogonal to that risk.
- **An attacker with the decrypted session in memory.** Once the plugin connects, the session string exists in the process. This is unavoidable for any client.
- **Message content already written to the vault.** The notes are plaintext Markdown, as the user wants them.

What it does protect against is the failure that actually happens: **the encrypted file lands in a git commit, a cloud backup, or a synced folder, and it is useless to whoever finds it there.**

## Alternatives considered and rejected

**Electron `safeStorage` (OS keychain).** Best-in-class on desktop. Requires `require('electron')`, which forces `isDesktopOnly: true`, which kills the mobile scenario that is the product's main differentiator (SPEC §12). Rejected on those grounds alone, not on security.

**Plaintext in `data.json`.** This is what `Plugin.saveData` is for, and it is exactly the path into git and iCloud described above. Rejected.

**GramJS `StoreSession` (browser `localStorage`).** Prior art: the `obsidian-telegram-sync` plugin does this. It has one genuine advantage — `localStorage` is outside the vault, so it is not touched by Obsidian Sync, Syncthing or git, which removes the leak vector we care most about. It was still rejected:

- It stores the session *in plaintext*. Any other installed plugin can read it with one line of JS; so can anyone who opens developer tools; so can a full-disk backup of the Electron profile.
- Its lifetime is not ours to control. WebView storage can be evicted, and on mobile it is cleared by "clear app data", losing the session silently.
- It is invisible to the user. "Wipe session" should delete something the user can see and verify, and a file in the plugin folder is that; a key inside a browser storage bucket is not.
- On desktop it lives in the Electron profile directory, which some users do back up.

Encrypting first makes the storage *location* a much smaller decision than the storage *format*, so we spend the complexity budget on the format and keep the location boring and inspectable.

**Encrypted blob in `localStorage`.** Combines the two above and is a defensible design. Rejected only for the eviction and invisibility reasons; if the file approach hits a mobile wall in the beta, this is the fallback and the file format above carries over unchanged.

**No persistence — log in every launch.** Honest and safest. Discarded because it destroys the product: mobile Obsidian is opened for fifteen seconds at a time, and a login flow per launch means nobody uses it.

## Revocation

Two independent paths, both documented in the wizard's final step and the README:

1. **In the plugin:** "Disconnect and delete session" calls `logout()`, which terminates the session server-side at Telegram, and then `wipe()`, which deletes the encrypted file. If `logout()` fails because the device is offline, `wipe()` still runs and the user is told the server-side session is still live and shown path 2.
2. **In Telegram:** Settings → Devices → terminate. Works even if the vault is gone. This is why the plugin sets a recognisable `deviceModel`/`appVersion` — the user must be able to find our session in that list. It must not be set from `os.hostname()`; that is a Node API.

## Forgotten passphrase

There is no recovery. The file is deleted and the user logs in again. This costs one minute and is stated at the passphrase step before the user commits, in those words. A recovery mechanism would be a second door to the same room.

## Test coverage

`tests/session-crypto.test.ts`, 21 assertions, all passing. Beyond the happy path they pin down the properties this document claims: fresh salt and IV per write, ciphertext divergence for identical plaintext, rejection of a wrong passphrase, of a flipped ciphertext bit, of a tampered IV, of a downgraded iteration count, and of every malformed file shape. A regression in any of these is a security regression, not a bug.

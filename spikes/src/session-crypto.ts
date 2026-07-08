/**
 * Spike 0.3 — session encryption prototype (WebCrypto only).
 *
 * Scheme, per docs/SECURITY-DECISION.md:
 *   passphrase --PBKDF2(SHA-256, N iters, random 16B salt)--> 256-bit key
 *   plaintext  --AES-256-GCM(random 12B IV)--> ciphertext (auth tag appended by WebCrypto)
 *
 * File format (JSON, base64 fields):
 *   { v: 1, kdf: "PBKDF2-SHA256", iters: number, salt: b64, iv: b64, ct: b64 }
 *
 * `iters` is stored in the file so that lowering the default on weak devices
 * does not lock existing users out of their own session file.
 *
 * No Node APIs. No third-party crypto. `crypto.subtle` is available in Obsidian
 * desktop (Electron renderer) and mobile (Capacitor WebView) alike.
 */

export const SESSION_FILE_VERSION = 1 as const;

/** OWASP 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000;

/** Floor for weak devices. Below this the passphrase stops carrying its weight. */
export const MIN_ITERATIONS = 210_000;

/** Budget from TZ 0.3: if derivation exceeds this on-device, step iterations down. */
export const KDF_BUDGET_MS = 2000;

const SALT_BYTES = 16;
const IV_BYTES = 12; // GCM standard; never reused across writes

export interface EncryptedSessionFile {
  v: typeof SESSION_FILE_VERSION;
  kdf: 'PBKDF2-SHA256';
  iters: number;
  salt: string;
  iv: string;
  ct: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('WRONG_PASSPHRASE');
    this.name = 'WrongPassphraseError';
  }
}

export class CorruptSessionFileError extends Error {
  constructor(reason: string) {
    super(`CORRUPT_SESSION_FILE: ${reason}`);
    this.name = 'CorruptSessionFileError';
  }
}

/* ------------------------------------------------------------------ */
/* base64 — no Buffer, no Node                                         */
/* ------------------------------------------------------------------ */

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* core                                                                */
/* ------------------------------------------------------------------ */

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the key never leaves WebCrypto
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSession(
  plaintext: string,
  passphrase: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<EncryptedSessionFile> {
  if (iterations < MIN_ITERATIONS) {
    throw new Error(`iterations below floor: ${iterations} < ${MIN_ITERATIONS}`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return {
    v: SESSION_FILE_VERSION,
    kdf: 'PBKDF2-SHA256',
    iters: iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(ct),
  };
}

export async function decryptSession(
  file: unknown,
  passphrase: string,
): Promise<string> {
  const f = assertShape(file);
  const key = await deriveKey(passphrase, fromBase64(f.salt), f.iters);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(f.iv) as BufferSource },
      key,
      fromBase64(f.ct) as BufferSource,
    );
  } catch {
    // GCM tag mismatch. Indistinguishable from a tampered file — by design we
    // report the common case and let the user retry.
    throw new WrongPassphraseError();
  }
  return new TextDecoder().decode(plain);
}

function assertShape(file: unknown): EncryptedSessionFile {
  if (typeof file !== 'object' || file === null) {
    throw new CorruptSessionFileError('not an object');
  }
  const f = file as Record<string, unknown>;
  if (f.v !== SESSION_FILE_VERSION) {
    throw new CorruptSessionFileError(`unsupported version ${String(f.v)}`);
  }
  if (f.kdf !== 'PBKDF2-SHA256') {
    throw new CorruptSessionFileError(`unsupported kdf ${String(f.kdf)}`);
  }
  if (typeof f.iters !== 'number' || f.iters < MIN_ITERATIONS) {
    throw new CorruptSessionFileError('iters missing or below floor');
  }
  for (const k of ['salt', 'iv', 'ct'] as const) {
    if (typeof f[k] !== 'string' || f[k] === '') {
      throw new CorruptSessionFileError(`field ${k} missing`);
    }
  }
  return f as unknown as EncryptedSessionFile;
}

/* ------------------------------------------------------------------ */
/* device calibration (spike 0.3 step 3)                               */
/* ------------------------------------------------------------------ */

export interface KdfBenchmark {
  iterations: number;
  medianMs: number;
  samples: number[];
}

export async function benchmarkKdf(
  iterations: number,
  runs = 3,
): Promise<KdfBenchmark> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  await deriveKey('warmup', salt, 10_000); // JIT + WebCrypto init
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await deriveKey('benchmark passphrase', salt, iterations);
    samples.push(performance.now() - t0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { iterations, medianMs: sorted[Math.floor(sorted.length / 2)], samples };
}

/**
 * Pick the highest iteration count whose derivation stays inside `budgetMs`
 * on this device. Never returns below MIN_ITERATIONS — if even the floor is
 * too slow, we return the floor and the caller warns the user.
 */
export async function calibrateIterations(
  budgetMs = KDF_BUDGET_MS,
): Promise<{ iterations: number; measuredMs: number; belowBudget: boolean }> {
  const ladder = [DEFAULT_ITERATIONS, 310_000, MIN_ITERATIONS];
  for (const iterations of ladder) {
    const { medianMs } = await benchmarkKdf(iterations, 1);
    if (medianMs <= budgetMs) return { iterations, measuredMs: medianMs, belowBudget: true };
  }
  const { medianMs } = await benchmarkKdf(MIN_ITERATIONS, 1);
  return { iterations: MIN_ITERATIONS, measuredMs: medianMs, belowBudget: false };
}

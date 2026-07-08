import { describe, expect, it } from 'vitest';
import {
  CorruptSessionFileError,
  DEFAULT_ITERATIONS,
  MIN_ITERATIONS,
  WrongPassphraseError,
  decryptSession,
  encryptSession,
  fromBase64,
  toBase64,
} from '../spikes/src/session-crypto';

// Tests run at the floor, not the default: 600k iterations × ~30 assertions is
// pure wall-clock with no added coverage. The iteration count is data, not code.
const FAST = MIN_ITERATIONS;

const SESSION = '1BQANOTEuMTA4LjU2LjE0MQG7' + 'A'.repeat(300);
const PASS = 'correct horse battery staple';

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes without Buffer', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('round-trips the empty array', () => {
    expect(fromBase64(toBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });
});

describe('encryptSession / decryptSession', () => {
  it('round-trips a session string', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    expect(await decryptSession(file, PASS)).toBe(SESSION);
  });

  it('round-trips unicode', async () => {
    const s = 'пароль 🔐 中文';
    expect(await decryptSession(await encryptSession(s, PASS, FAST), PASS)).toBe(s);
  });

  it('produces the documented file shape', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    expect(Object.keys(file).sort()).toEqual(['ct', 'iters', 'iv', 'kdf', 'salt', 'v']);
    expect(file.v).toBe(1);
    expect(file.kdf).toBe('PBKDF2-SHA256');
    expect(file.iters).toBe(FAST);
    expect(fromBase64(file.salt)).toHaveLength(16);
    expect(fromBase64(file.iv)).toHaveLength(12);
  });

  it('never stores the plaintext', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    const serialized = JSON.stringify(file);
    expect(serialized).not.toContain(SESSION);
    expect(serialized).not.toContain(PASS);
    expect(serialized).not.toContain(SESSION.slice(0, 16));
  });

  it('uses a fresh salt and IV on every write', async () => {
    const a = await encryptSession(SESSION, PASS, FAST);
    const b = await encryptSession(SESSION, PASS, FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct); // same plaintext, same passphrase, different ciphertext
  });

  it('rejects a wrong passphrase via the GCM tag', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    await expect(decryptSession(file, PASS + '!')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects an empty passphrase used against a real one', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    await expect(decryptSession(file, '')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('detects a flipped ciphertext bit (authenticated encryption, not just encryption)', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    const ct = fromBase64(file.ct);
    ct[0] ^= 0x01;
    await expect(decryptSession({ ...file, ct: toBase64(ct) }, PASS)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('detects a tampered IV', async () => {
    const file = await encryptSession(SESSION, PASS, FAST);
    const iv = fromBase64(file.iv);
    iv[0] ^= 0xff;
    await expect(decryptSession({ ...file, iv: toBase64(iv) }, PASS)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('detects a tampered iteration count (silent KDF downgrade)', async () => {
    const file = await encryptSession(SESSION, PASS, DEFAULT_ITERATIONS);
    await expect(
      decryptSession({ ...file, iters: MIN_ITERATIONS }, PASS),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('reads back a file written with a different iteration count', async () => {
    // The whole point of storing `iters`: lowering the default on a slow phone
    // must not lock the user out of a file written on a fast desktop.
    const file = await encryptSession(SESSION, PASS, DEFAULT_ITERATIONS);
    expect(await decryptSession(file, PASS)).toBe(SESSION);
  }, 20_000);

  it('refuses to write below the iteration floor', async () => {
    await expect(encryptSession(SESSION, PASS, 1000)).rejects.toThrow(/below floor/);
  });
});

describe('decryptSession input validation', () => {
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['a string', 'nope'],
    ['unknown version', { v: 2, kdf: 'PBKDF2-SHA256', iters: MIN_ITERATIONS, salt: 'a', iv: 'a', ct: 'a' }],
    ['unknown kdf', { v: 1, kdf: 'scrypt', iters: MIN_ITERATIONS, salt: 'a', iv: 'a', ct: 'a' }],
    ['iters below floor', { v: 1, kdf: 'PBKDF2-SHA256', iters: 1, salt: 'a', iv: 'a', ct: 'a' }],
    ['missing salt', { v: 1, kdf: 'PBKDF2-SHA256', iters: MIN_ITERATIONS, iv: 'a', ct: 'a' }],
    ['empty ct', { v: 1, kdf: 'PBKDF2-SHA256', iters: MIN_ITERATIONS, salt: 'a', iv: 'a', ct: '' }],
  ];

  for (const [name, input] of cases) {
    it(`rejects ${name}`, async () => {
      await expect(decryptSession(input, PASS)).rejects.toBeInstanceOf(CorruptSessionFileError);
    });
  }
});

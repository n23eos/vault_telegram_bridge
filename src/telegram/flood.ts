/**
 * Rate limiting and transient-conflict policy. TZ §5.2.
 *
 * The Bot API returns two things we must survive rather than surface:
 *
 *   429 + parameters.retry_after — we are polling too fast. Honour the server's
 *        number; it knows and we do not.
 *   409 Conflict                 — another `getUpdates` is already open for this
 *        bot. With one vault on a desktop and a phone this is the *normal*
 *        steady state, not an error (ADR-001). Back off and let the other device
 *        do the work; the note reaches us through vault sync.
 *
 * Everything here is pure except `sleep`, which is injected, so the policy is
 * testable with fake timers and without waiting.
 */

import { errConflict, errRateLimited, HumanError } from '../errors';

/** Telegram's own floor between polls. Below this we are the problem. */
export const MIN_REQUEST_INTERVAL_MS = 1000;

/** 409 means someone else is polling. Wait this long before we try to take over. */
export const CONFLICT_BASE_DELAY_MS = 5_000;
export const CONFLICT_MAX_DELAY_MS = 60_000;

/** Above this, a wait is long enough that the user deserves to be told. */
export const NOTIFY_THRESHOLD_SECONDS = 60;

export interface FloodPolicyDeps {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** ±10% so that N devices coming back online together do not resynchronise. */
  jitter: () => number;
  onLongWait?: (seconds: number) => void;
}

export function realDeps(onLongWait?: (seconds: number) => void): FloodPolicyDeps {
  return {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    jitter: () => Math.random(),
    onLongWait,
  };
}

export function withJitter(ms: number, jitter: number): number {
  // jitter ∈ [0,1) → factor ∈ [0.9, 1.1)
  return Math.round(ms * (0.9 + jitter * 0.2));
}

export class FloodPolicy {
  private lastRequestAt = 0;
  private conflictStreak = 0;

  constructor(private readonly deps: FloodPolicyDeps) {}

  /** Enforces the global minimum interval between outbound requests. */
  async gate(): Promise<void> {
    const elapsed = this.deps.now() - this.lastRequestAt;
    if (this.lastRequestAt !== 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
      await this.deps.sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = this.deps.now();
  }

  /**
   * Wait out a 429. `retryAfter` is seconds, straight from Telegram.
   * Returns after the wait; the caller retries.
   */
  async waitForRateLimit(retryAfter: number): Promise<void> {
    const seconds = Math.max(1, Math.ceil(retryAfter));
    if (seconds > NOTIFY_THRESHOLD_SECONDS) this.deps.onLongWait?.(seconds);
    await this.deps.sleep(withJitter(seconds * 1000, this.deps.jitter()));
  }

  /**
   * Back off from a 409. Exponential from 5 s, capped at 60 s, so a phone left
   * open next to a desktop settles into one poll a minute instead of hammering.
   */
  async waitForConflict(): Promise<void> {
    const delay = Math.min(
      CONFLICT_BASE_DELAY_MS * 2 ** this.conflictStreak,
      CONFLICT_MAX_DELAY_MS,
    );
    this.conflictStreak++;
    await this.deps.sleep(withJitter(delay, this.deps.jitter()));
  }

  /** Any successful request clears the conflict escalation. */
  succeeded(): void {
    this.conflictStreak = 0;
  }

  get conflictAttempts(): number {
    return this.conflictStreak;
  }
}

/**
 * Maps a Bot API failure onto our error vocabulary.
 * `undefined` means "not a rate-limit or conflict — let the caller decide".
 */
export function classifyStatus(
  status: number,
  body: { description?: string; parameters?: { retry_after?: number } } | undefined,
): HumanError | undefined {
  if (status === 429) return errRateLimited(body?.parameters?.retry_after ?? 1);
  if (status === 409) return errConflict();
  return undefined;
}

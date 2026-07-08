import { describe, expect, it, vi } from 'vitest';
import {
  classifyStatus,
  CONFLICT_BASE_DELAY_MS,
  CONFLICT_MAX_DELAY_MS,
  FloodPolicy,
  MIN_REQUEST_INTERVAL_MS,
  withJitter,
  type FloodPolicyDeps,
} from '../src/telegram/flood';

/** Deterministic clock and sleep: the policy is pure, so no timers are needed. */
function harness(overrides: Partial<FloodPolicyDeps> = {}) {
  const slept: number[] = [];
  let clock = 1_000_000;
  const deps: FloodPolicyDeps = {
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    jitter: () => 0.5, // → factor 1.0, so waits are exact
    ...overrides,
  };
  return { deps, slept, tick: (ms: number) => (clock += ms), policy: new FloodPolicy(deps) };
}

describe('withJitter', () => {
  it('spans ±10%', () => {
    expect(withJitter(1000, 0)).toBe(900);
    expect(withJitter(1000, 0.5)).toBe(1000);
    expect(withJitter(1000, 0.999)).toBe(1100);
  });

  it('never returns a negative or fractional delay', () => {
    for (const j of [0, 0.25, 0.5, 0.75, 0.999]) {
      const v = withJitter(5000, j);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('FloodPolicy.gate', () => {
  it('does not delay the first request', async () => {
    const { policy, slept } = harness();
    await policy.gate();
    expect(slept).toEqual([]);
  });

  it('enforces the minimum interval between back-to-back requests', async () => {
    const { policy, slept } = harness();
    await policy.gate();
    await policy.gate();
    expect(slept).toEqual([MIN_REQUEST_INTERVAL_MS]);
  });

  it('does not delay when enough time already passed', async () => {
    const { policy, slept, tick } = harness();
    await policy.gate();
    tick(MIN_REQUEST_INTERVAL_MS + 1);
    await policy.gate();
    expect(slept).toEqual([]);
  });

  it('waits only the remainder', async () => {
    const { policy, slept, tick } = harness();
    await policy.gate();
    tick(400);
    await policy.gate();
    expect(slept).toEqual([MIN_REQUEST_INTERVAL_MS - 400]);
  });
});

describe('FloodPolicy.waitForRateLimit', () => {
  it('honours the server’s retry_after, in milliseconds', async () => {
    const { policy, slept } = harness();
    await policy.waitForRateLimit(3);
    expect(slept).toEqual([3000]);
  });

  it('rounds a fractional retry_after up and floors at one second', async () => {
    const { policy, slept } = harness();
    await policy.waitForRateLimit(0);
    await policy.waitForRateLimit(1.2);
    expect(slept).toEqual([1000, 2000]);
  });

  it('notifies the user only for a long wait', async () => {
    const onLongWait = vi.fn();
    const { policy } = harness({ onLongWait });
    await policy.waitForRateLimit(60);
    expect(onLongWait).not.toHaveBeenCalled();
    await policy.waitForRateLimit(61);
    expect(onLongWait).toHaveBeenCalledWith(61);
  });

  it('applies jitter so devices do not resynchronise', async () => {
    const { policy, slept } = harness({ jitter: () => 0 });
    await policy.waitForRateLimit(10);
    expect(slept[0]).toBe(9000);
  });
});

describe('FloodPolicy.waitForConflict', () => {
  it('backs off exponentially from the base delay', async () => {
    const { policy, slept } = harness();
    await policy.waitForConflict();
    await policy.waitForConflict();
    await policy.waitForConflict();
    expect(slept).toEqual([
      CONFLICT_BASE_DELAY_MS,
      CONFLICT_BASE_DELAY_MS * 2,
      CONFLICT_BASE_DELAY_MS * 4,
    ]);
  });

  it('caps the backoff', async () => {
    const { policy, slept } = harness();
    for (let i = 0; i < 10; i++) await policy.waitForConflict();
    expect(Math.max(...slept)).toBe(CONFLICT_MAX_DELAY_MS);
  });

  it('resets after a successful request', async () => {
    const { policy, slept } = harness();
    await policy.waitForConflict();
    await policy.waitForConflict();
    policy.succeeded();
    await policy.waitForConflict();
    expect(slept[2]).toBe(CONFLICT_BASE_DELAY_MS);
    expect(policy.conflictAttempts).toBe(1);
  });
});

describe('classifyStatus', () => {
  it('maps 429 to a rate limit carrying retry_after', () => {
    const e = classifyStatus(429, { parameters: { retry_after: 17 } });
    expect(e?.key).toBe('error.rateLimited');
    expect(e?.params?.seconds).toBe(17);
  });

  it('defaults retry_after to one second when Telegram omits it', () => {
    expect(classifyStatus(429, {})?.params?.seconds).toBe(1);
    expect(classifyStatus(429, undefined)?.params?.seconds).toBe(1);
  });

  it('maps 409 to a conflict — the other device is polling, not an error', () => {
    expect(classifyStatus(409, undefined)?.key).toBe('error.conflict');
  });

  it('leaves everything else to the caller', () => {
    for (const s of [200, 400, 401, 404, 500, 502]) {
      expect(classifyStatus(s, undefined)).toBeUndefined();
    }
  });
});

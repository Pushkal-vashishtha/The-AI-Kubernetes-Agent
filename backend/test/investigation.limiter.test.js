// Run: node --test backend/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInvestigationLimiter } from "../src/api/investigation.limiter.js";

// A controllable clock, so the rolling window is tested without waiting.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const HOUR = 60 * 60 * 1000;

test("allows one investigation at a time per user", () => {
  const c = clock();
  const limiter = createInvestigationLimiter({ maxPerWindow: 10, windowMs: HOUR, now: c.now });

  const first = limiter.acquire("alice");
  assert.equal(first.ok, true);

  const second = limiter.acquire("alice");
  assert.equal(second.ok, false);
  assert.equal(second.status, 429);
  assert.match(second.message, /already running/);

  first.release();
  assert.equal(limiter.acquire("alice").ok, true);
});

test("users do not share limits", () => {
  const limiter = createInvestigationLimiter({ maxPerWindow: 1, windowMs: HOUR });
  assert.equal(limiter.acquire("alice").ok, true);
  assert.equal(limiter.acquire("bob").ok, true);
});

test("caps investigations per rolling window and says when to retry", () => {
  const c = clock();
  const limiter = createInvestigationLimiter({ maxPerWindow: 3, windowMs: HOUR, now: c.now });

  for (let i = 0; i < 3; i++) {
    const slot = limiter.acquire("alice");
    assert.equal(slot.ok, true, `investigation ${i + 1} should be allowed`);
    slot.release();
    c.advance(60_000); // one minute apart
  }

  const blocked = limiter.acquire("alice");
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /3 investigations in the last hour/);
  // Oldest started at t0; now is t0+3min, so it frees at t0+60min: 57 minutes.
  assert.equal(blocked.retryAfterSeconds, 57 * 60);

  // Once the oldest falls out of the window, one more is allowed.
  c.advance(57 * 60_000 + 1);
  assert.equal(limiter.acquire("alice").ok, true);
});

test("a blocked attempt does not consume quota", () => {
  const c = clock();
  const limiter = createInvestigationLimiter({ maxPerWindow: 1, windowMs: HOUR, now: c.now });

  limiter.acquire("alice").release();
  for (let i = 0; i < 5; i++) assert.equal(limiter.acquire("alice").ok, false);

  c.advance(HOUR + 1);
  assert.equal(limiter.acquire("alice").ok, true);
});

test("release is idempotent", () => {
  const limiter = createInvestigationLimiter({ maxPerWindow: 10, windowMs: HOUR });
  const slot = limiter.acquire("alice");
  slot.release();
  slot.release(); // the route calls it on both "finish" and "close"

  const next = limiter.acquire("alice");
  assert.equal(next.ok, true);
  // A stale release from the first slot must not free the second.
  slot.release();
  assert.equal(limiter.acquire("alice").ok, false);
});

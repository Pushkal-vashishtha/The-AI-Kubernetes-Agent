// Per-user limits on investigations.
//
// Every investigation is a paid LLM call on one shared OpenRouter key, so one
// user (or one stuck browser tab) must not be able to spend it for everyone.
// Two rules:
//   - one investigation at a time per user
//   - at most `maxPerWindow` started in any rolling window
//
// In-memory, like the agent hub: correct for the single backend instance this
// project runs. Several instances would need a shared store (e.g. Redis).

export function createInvestigationLimiter({ maxPerWindow, windowMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const startedAt = new Map(); // userId -> timestamps of started investigations
  const running = new Set(); // userIds with one in flight

  function recent(userId) {
    const cutoff = now() - windowMs;
    const kept = (startedAt.get(userId) ?? []).filter((t) => t > cutoff);
    if (kept.length) startedAt.set(userId, kept);
    else startedAt.delete(userId);
    return kept;
  }

  return {
    /**
     * Try to start an investigation. Returns { ok: true, release } -- call
     * release() exactly when it finishes (extra calls are harmless) -- or
     * { ok: false, status, message, retryAfterSeconds }.
     */
    acquire(userId) {
      if (running.has(userId)) {
        return {
          ok: false,
          status: 429,
          retryAfterSeconds: 10,
          message: "An investigation is already running for your account. Wait for it to finish.",
        };
      }

      const times = recent(userId);
      if (times.length >= maxPerWindow) {
        const retryAfterSeconds = Math.max(1, Math.ceil((times[0] + windowMs - now()) / 1000));
        const minutes = Math.ceil(retryAfterSeconds / 60);
        return {
          ok: false,
          status: 429,
          retryAfterSeconds,
          message: `You've run ${maxPerWindow} investigations in the last hour. Try again in about ${minutes} minute(s).`,
        };
      }

      running.add(userId);
      startedAt.set(userId, [...times, now()]);

      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          running.delete(userId);
        },
      };
    },
  };
}

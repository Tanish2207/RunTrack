/** Cached wall clock for useSyncExternalStore; reads are stable between ticks. */
export function createElapsedClock() {
  let now = Date.now();
  return {
    getSnapshot: () => now,
    subscribe: (onTick: () => void): (() => void) => {
      const update = () => { now = Date.now(); onTick(); };
      // A resumed/focused view must not wait a full second to catch up.
      update();
      const timer = setInterval(update, 1000);
      return () => clearInterval(timer);
    },
  };
}

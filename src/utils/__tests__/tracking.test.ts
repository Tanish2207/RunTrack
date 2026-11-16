import { describe, expect, it } from 'vitest';

import type { RoutePoint } from '../../api/types';
import {
  PACE_FIX_MAX_AGE_MS,
  PACE_SAMPLE_COUNT,
  computeElapsedMs,
  currentPaceSecPerKm,
  type ElapsedState,
} from '../tracking';

function point(timestamp: number, speed?: number): RoutePoint {
  return speed === undefined ? { lat: 10, lng: 20, timestamp } : { lat: 10, lng: 20, timestamp, speed };
}

describe('computeElapsedMs', () => {
  it('returns zero for an idle session', () => {
    expect(computeElapsedMs({ startedAt: null, totalPausedMs: 0, pauseStartedAt: null }, 60_000)).toBe(0);
  });

  it('supports a real session starting at epoch zero', () => {
    expect(computeElapsedMs({ startedAt: 0, totalPausedMs: 0, pauseStartedAt: null }, 60_000)).toBe(60_000);
  });

  it('subtracts all completed pause spans without accumulating ticker drift', () => {
    const state: ElapsedState = { startedAt: 1000, totalPausedMs: 10_000 + 20_000, pauseStartedAt: null };
    expect(computeElapsedMs(state, 91_000)).toBe(60_000);
    expect(computeElapsedMs(state, 94_125)).toBe(63_125);
  });

  it('excludes both completed pauses and the still-open trailing pause', () => {
    const state: ElapsedState = { startedAt: 0, totalPausedMs: 15_000, pauseStartedAt: 60_000 };
    expect(computeElapsedMs(state, 60_000)).toBe(45_000);
    expect(computeElapsedMs(state, 600_000)).toBe(45_000);
  });

  it('treats a pause beginning at epoch zero as an open pause, not as a falsy value', () => {
    expect(computeElapsedMs({ startedAt: 0, totalPausedMs: 0, pauseStartedAt: 0 }, 60_000)).toBe(0);
  });

  it('resumes continuously once the open pause is folded into the accumulated total', () => {
    const paused = { startedAt: 1000, totalPausedMs: 10_000, pauseStartedAt: 51_000 };
    const resumed = { startedAt: 1000, totalPausedMs: 40_000, pauseStartedAt: null };
    expect(computeElapsedMs(paused, 81_000)).toBe(40_000);
    expect(computeElapsedMs(resumed, 81_000)).toBe(40_000);
    expect(computeElapsedMs(resumed, 91_000)).toBe(50_000);
  });

  it.each([
    [{ startedAt: 1000, totalPausedMs: 0, pauseStartedAt: null }, 500],
    [{ startedAt: 0, totalPausedMs: 20_000, pauseStartedAt: null }, 10_000],
    [{ startedAt: 1000, totalPausedMs: 0, pauseStartedAt: 500 }, 10_000],
  ] as const)('clamps negative active time to zero: %j', (state, now) => {
    expect(computeElapsedMs(state, now)).toBe(0);
  });

  it('does not modify the elapsed state', () => {
    const state = Object.freeze({ startedAt: 0, totalPausedMs: 10_000, pauseStartedAt: 20_000 });
    computeElapsedMs(state, 30_000);
    expect(state).toEqual({ startedAt: 0, totalPausedMs: 10_000, pauseStartedAt: 20_000 });
  });
});

describe('currentPaceSecPerKm', () => {
  it('smooths speed over exactly the latest three fixes, ignoring an earlier outlier', () => {
    expect(PACE_SAMPLE_COUNT).toBe(3);
    expect(currentPaceSecPerKm([point(0, 20), point(2000, 2), point(4000, 3), point(6000, 4)], 60, 0.2, 6000)).toBe(333);
  });

  it('works with fewer than three speed samples and rounds seconds per kilometer', () => {
    expect(currentPaceSecPerKm([point(1000, 2)], 60, 0.2, 1000)).toBe(500);
    expect(currentPaceSecPerKm([point(1000, 2), point(3000, 4)], 60, 0.2, 3000)).toBe(333);
  });

  it('averages only available valid speeds inside the three-fix window', () => {
    expect(currentPaceSecPerKm([point(0, 10), point(2000, 2), point(4000), point(6000, 4)], 60, 0.2, 6000)).toBe(333);
  });

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to session average pace when fresh fixes have no valid speed: %s', (speed) => {
      expect(currentPaceSecPerKm([point(1000, speed)], 1800, 5, 1000)).toBe(360);
    },
  );

  it('uses the average-distance guard when the speed fallback has too little distance', () => {
    expect(currentPaceSecPerKm([point(1000)], 60, 0.049, 1000)).toBe(0);
    expect(currentPaceSecPerKm([point(1000)], 60, 0.05, 1000)).toBe(1200);
  });

  it('does not reuse a stale speed sample when the newest fix is fresh', () => {
    const now = 20_000;
    expect(currentPaceSecPerKm([point(now - PACE_FIX_MAX_AGE_MS - 1, 20), point(now, 2)], 1800, 5, now)).toBe(500);
    expect(currentPaceSecPerKm([point(now - PACE_FIX_MAX_AGE_MS - 1, 20), point(now)], 1800, 5, now)).toBe(360);
  });

  it('returns no current pace for a stale latest fix rather than showing an old speed or average', () => {
    expect(currentPaceSecPerKm([point(0, 3)], 1800, 5, PACE_FIX_MAX_AGE_MS + 1)).toBe(0);
    expect(currentPaceSecPerKm([point(0)], 1800, 5, PACE_FIX_MAX_AGE_MS + 1)).toBe(0);
  });

  it('accepts a latest fix at the exact freshness boundary', () => {
    expect(currentPaceSecPerKm([point(0, 2)], 1800, 5, PACE_FIX_MAX_AGE_MS)).toBe(500);
  });

  it('shows no pre-pause pace when the newly resumed segment is empty', () => {
    const segments = [[point(1000, 3)], []];
    expect(currentPaceSecPerKm(segments[0], 1800, 5, 2000)).toBe(333);
    expect(currentPaceSecPerKm(segments[1], 1800, 5, 2000)).toBe(0);
  });

  it('never searches an older fix beyond the three-fix window for a speed', () => {
    expect(currentPaceSecPerKm([point(0, 20), point(2000), point(4000), point(6000)], 1800, 5, 6000)).toBe(360);
  });

  it.each([0, 0.1, 0.299])('shows no pace when the measured speed is stationary/too slow: %s', (speed) => {
    expect(currentPaceSecPerKm([point(1000, speed)], 1800, 5, 1000)).toBe(0);
  });

  it('includes measured zero speed in smoothing instead of treating it as missing', () => {
    expect(currentPaceSecPerKm([point(0, 0), point(2000, 0), point(4000, 3)], 1800, 5, 4000)).toBe(1000);
    expect(currentPaceSecPerKm([point(0, 0.3)], 1800, 5, 0)).toBe(3333);
  });

  it('does not mutate the current segment', () => {
    const segment = Object.freeze([Object.freeze(point(1000, 3))]);
    expect(currentPaceSecPerKm(segment, 1800, 5, 1000)).toBe(333);
    expect(segment).toEqual([point(1000, 3)]);
  });
});

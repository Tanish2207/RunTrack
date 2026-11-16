import type { RoutePoint } from '../api/types';
import { avgPaceSecPerKm } from './stats';

export interface ElapsedState {
  startedAt: number | null;
  totalPausedMs: number;
  pauseStartedAt: number | null;
}

/** Timestamp-derived time: ticking never accumulates error, and pauses freeze it. */
export function computeElapsedMs(state: ElapsedState, now: number): number {
  if (state.startedAt === null) return 0;
  const effectiveEnd = state.pauseStartedAt ?? now;
  return Math.max(0, effectiveEnd - state.startedAt - state.totalPausedMs);
}

export const PACE_SAMPLE_COUNT = 3;
export const PACE_FIX_MAX_AGE_MS = 15_000;
const MIN_MOVING_SPEED_MPS = 0.3;

/** Smooth only the current segment, never a stale fix or a pre-pause speed. */
export function currentPaceSecPerKm(
  segment: readonly RoutePoint[],
  durationSec: number,
  distanceKm: number,
  now: number,
): number {
  const latest = segment[segment.length - 1];
  if (!latest || now - latest.timestamp > PACE_FIX_MAX_AGE_MS) return 0;

  let speedSum = 0;
  let samples = 0;
  for (let i = Math.max(0, segment.length - PACE_SAMPLE_COUNT); i < segment.length; i++) {
    const { speed, timestamp } = segment[i];
    if (
      speed !== undefined && Number.isFinite(speed) && speed >= 0 &&
      now - timestamp <= PACE_FIX_MAX_AGE_MS
    ) {
      speedSum += speed;
      samples++;
    }
  }
  if (samples === 0) return avgPaceSecPerKm(durationSec, distanceKm);
  const speedMps = speedSum / samples;
  return speedMps >= MIN_MOVING_SPEED_MPS ? Math.round(1000 / speedMps) : 0;
}

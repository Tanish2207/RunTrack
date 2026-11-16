import type { ActivityType, RoutePoint, SessionSnapshot } from '../api/types';
import { computeSegmentDistanceKm } from './geo';

/**
 * Session stats (spec §3.3): duration minus pauses, average pace, calories.
 * Pure — all inputs explicit so the pause math is deterministic and testable.
 */
export const DEFAULT_WEIGHT_KG = 70;
/** Below this distance, pace is meaningless; callers render "—" for pace 0. */
export const MIN_PACE_DISTANCE_KM = 0.05;

/** Wall-clock elapsed time minus any paused intervals, rounded to seconds. */
export function computeDurationSec(
  startedAt: number,
  endedAt: number,
  totalPausedMs: number,
): number {
  const activeMs = Math.max(0, endedAt - startedAt - totalPausedMs);
  return Math.round(activeMs / 1000);
}

/** mm:ss-per-km as seconds; returns 0 when distance is negligible. */
export function avgPaceSecPerKm(durationSec: number, distanceKm: number): number {
  if (distanceKm < MIN_PACE_DISTANCE_KM) return 0;
  return Math.round(durationSec / distanceKm);
}

/**
 * Simple MET-based estimate (spec §3.3): `distanceKm * weightKg * 1.036`,
 * default weight 70 kg when the profile has none. Elevation is out of scope.
 */
export function caloriesBurned(distanceKm: number, weightKg: number = DEFAULT_WEIGHT_KG): number {
  const weight = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG;
  const kcal = distanceKm * weight * 1.036;
  return Math.round(kcal * 10) / 10;
}

/**
 * Compose a finished-session snapshot from raw tracking state.
 * Sum distance inside each segment, then flatten for the storage route. Copy
 * points so subsequent store updates cannot mutate the finished run.
 */
export function computeSessionStats(args: {
  type: ActivityType;
  segments: readonly (readonly RoutePoint[])[];
  startedAt: number;
  endedAt: number;
  totalPausedMs: number;
  weightKg?: number;
}): SessionSnapshot {
  const { type, segments, startedAt, endedAt, totalPausedMs, weightKg } = args;
  const snapshotSegments = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.map((point) => ({ ...point })));
  const points = snapshotSegments.flat();
  const distanceKm = computeSegmentDistanceKm(snapshotSegments);
  const durationSec = computeDurationSec(startedAt, endedAt, totalPausedMs);
  return {
    activityType: type,
    points,
    segments: snapshotSegments,
    startedAt,
    endedAt,
    durationSec,
    distanceKm,
    avgPaceSecPerKm: avgPaceSecPerKm(durationSec, distanceKm),
    caloriesEstimate: caloriesBurned(distanceKm, weightKg),
  };
}

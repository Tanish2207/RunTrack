import { describe, expect, it } from 'vitest';

import type { RoutePoint } from '../../api/types';
import { computeDistanceKm } from '../geo';
import {
  DEFAULT_WEIGHT_KG,
  MIN_PACE_DISTANCE_KM,
  avgPaceSecPerKm,
  caloriesBurned,
  computeDurationSec,
  computeSessionStats,
} from '../stats';

// Same analytic anchor as geo.test.ts: 1° of latitude on the 6371 km sphere.
const KM_PER_DEG_LAT = (6371 * Math.PI) / 180; // ≈ 111.194927

function point(lat: number, lng: number, timestamp: number): RoutePoint {
  return { lat, lng, timestamp };
}

describe('computeDurationSec', () => {
  it('wall-clock elapsed time without pauses', () => {
    expect(computeDurationSec(0, 1_800_000, 0)).toBe(1800);
    // Sub-second remainder rounds to nearest second.
    expect(computeDurationSec(1_000_000, 1_065_500, 0)).toBe(66);
  });

  it('subtracts paused intervals', () => {
    // 1 h wall clock − 10 min paused → 50 min active.
    expect(computeDurationSec(0, 3_600_000, 600_000)).toBe(3000);
  });

  it('clamps negative active time to 0', () => {
    expect(computeDurationSec(1_000, 500, 0)).toBe(0); // ended before started
    expect(computeDurationSec(0, 60_000, 120_000)).toBe(0); // paused longer than elapsed
  });
});

describe('avgPaceSecPerKm', () => {
  it('ticket values: (1800, 0) → 0 and (1800, 5) → 360', () => {
    expect(avgPaceSecPerKm(1800, 0)).toBe(0);
    expect(avgPaceSecPerKm(1800, 5)).toBe(360);
  });

  it('guard below MIN_PACE_DISTANCE_KM: 0.049 → 0', () => {
    expect(MIN_PACE_DISTANCE_KM).toBe(0.05);
    expect(avgPaceSecPerKm(1800, 0.049)).toBe(0);
  });

  it('boundary is inclusive at exactly MIN_PACE_DISTANCE_KM', () => {
    expect(avgPaceSecPerKm(1800, MIN_PACE_DISTANCE_KM)).toBe(36000); // 1800 / 0.05
  });
});

describe('caloriesBurned', () => {
  it('ticket value: (5, 70) = 362.6 (±0.05)', () => {
    expect(caloriesBurned(5, 70)).toBeCloseTo(362.6, 1); // 5 × 70 × 1.036
  });

  it('defaults to 70 kg when no profile weight', () => {
    expect(DEFAULT_WEIGHT_KG).toBe(70);
    expect(caloriesBurned(5)).toBeCloseTo(362.6, 1);
    expect(caloriesBurned(5)).toBe(caloriesBurned(5, DEFAULT_WEIGHT_KG));
  });

  it('scales linearly with weight and distance', () => {
    expect(caloriesBurned(10, 80)).toBeCloseTo(828.8, 1); // 10 × 80 × 1.036
  });

  it('zero distance → 0', () => {
    expect(caloriesBurned(0, 70)).toBe(0);
  });
});

describe('computeSessionStats', () => {
  it('two segments across a pause: distance sums segments, duration excludes pause', () => {
    // Synthetic 30 min session: 10 min running, 10 min paused, 10 min running.
    // The runner stands still during the pause, so segment B restarts at
    // A's last fix — the seam contributes 0 km and the total distance is
    // exactly the sum of the segment distances (4 moving steps of 0.1°).
    const startedAt = 0;
    const runMs = 600_000; // 10 min
    const pausedMs = 600_000; // 10 min
    const endedAt = 2 * runMs + pausedMs;

    const stepKm = 0.1 * KM_PER_DEG_LAT; // analytic ≈ 11.119493 km per 0.1° step

    const segmentA: RoutePoint[] = [
      point(10.0, 0, 0),
      point(10.1, 0, runMs / 2),
      point(10.2, 0, runMs),
    ];
    const segmentB: RoutePoint[] = [
      point(10.2, 0, runMs + pausedMs), // same fix as A's last point → 0 km seam
      point(10.3, 0, runMs + pausedMs + runMs / 2),
      point(10.4, 0, runMs + pausedMs + runMs),
    ];

    const snapshot = computeSessionStats({
      type: 'run',
      segments: [segmentA, segmentB],
      startedAt,
      endedAt,
      totalPausedMs: pausedMs,
    });

    // Distance = sum of segment distances (verified both compositionally and analytically).
    const segmentSum = computeDistanceKm(segmentA) + computeDistanceKm(segmentB);
    expect(snapshot.distanceKm).toBeCloseTo(segmentSum, 6);
    expect(snapshot.distanceKm).toBeCloseTo(4 * stepKm, 6);
    expect(snapshot.distanceKm).toBeCloseTo(44.477971, 4); // 4 × 11.119493, analytic

    // Duration excludes the paused 10 min: 30 min wall − 10 min = 20 min.
    expect(snapshot.durationSec).toBe(1200);
    expect(snapshot.avgPaceSecPerKm).toBe(Math.round(1200 / (4 * stepKm))); // 27 s/km
    // Default weight 70 kg: distance × 70 × 1.036, rounded to 1 decimal.
    expect(snapshot.caloriesEstimate).toBeCloseTo(4 * stepKm * 70 * 1.036, 1);

    // Snapshot shape: every field present, points flattened (3 + 3).
    expect(snapshot.activityType).toBe('run');
    expect(snapshot.startedAt).toBe(0);
    expect(snapshot.endedAt).toBe(endedAt);
    expect(snapshot.points).toHaveLength(6);
    expect(snapshot.points[2].lat).toBe(10.2); // last fix of segment A
    expect(snapshot.points[3].lat).toBe(10.2); // pause seam shares the fix
    expect(snapshot.points[5].lat).toBe(10.4); // last fix of segment B
  });
});

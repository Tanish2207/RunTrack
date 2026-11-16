import { describe, expect, it } from 'vitest';

import type { RoutePoint } from '../../api/types';
import { computeDistanceKm, getDistanceFromLatLonInKm } from '../geo';

/**
 * Analytic anchor for every expectation below: on the spec's sphere
 * (R = 6371 km), 1° of latitude along a meridian is exactly R·(π/180).
 * Derived values are verified analytically, not eyeballed:
 *   1 step  (1°)   = 111.194927 km
 *   2 steps (2°)   = 222.389853 km
 */
const EARTH_RADIUS_KM = 6371; // matches EARTH_RADIUS_KM in ../geo (spec §3.3)
const KM_PER_DEG_LAT = (EARTH_RADIUS_KM * Math.PI) / 180; // ≈ 111.194927

function point(lat: number, lng: number, timestamp = 0): RoutePoint {
  return { lat, lng, timestamp };
}

describe('getDistanceFromLatLonInKm (haversine)', () => {
  it('Berlin → Paris ≈ 878 km (ticket: within [876, 880])', () => {
    const d = getDistanceFromLatLonInKm(52.52, 13.405, 48.8566, 2.3522);
    expect(d).toBeGreaterThanOrEqual(876);
    expect(d).toBeLessThanOrEqual(880);
    // Independent hand-computed haversine reference for these coordinates: 877.46 km.
    expect(d).toBeCloseTo(877.46, 1);
  });

  it('identical points → exactly 0', () => {
    expect(getDistanceFromLatLonInKm(10, 20, 10, 20)).toBe(0);
  });

  it('symmetric: A→B equals B→A', () => {
    const ab = getDistanceFromLatLonInKm(52.52, 13.405, 48.8566, 2.3522);
    const ba = getDistanceFromLatLonInKm(48.8566, 2.3522, 52.52, 13.405);
    expect(ab).toBeCloseTo(ba, 9);
  });
});

describe('computeDistanceKm', () => {
  it('3 meridian points 1° of latitude apart sum exactly (analytic 2 × 111.194927)', () => {
    // Pairwise legs are exactly R·π/180 each, so the route total is
    // 2 × 111.194927 = 222.389853 km — checked analytically to 6 decimals.
    const route = [point(10, 0), point(11, 0), point(12, 0)];
    expect(computeDistanceKm(route)).toBeCloseTo(2 * KM_PER_DEG_LAT, 6);
    expect(computeDistanceKm(route)).toBeCloseTo(222.389853, 4);
  });

  it('empty route → 0', () => {
    expect(computeDistanceKm([])).toBe(0);
  });

  it('single-point route → 0', () => {
    expect(computeDistanceKm([point(52.52, 13.405)])).toBe(0);
  });

  it('repeated identical points contribute nothing', () => {
    expect(computeDistanceKm([point(10, 0), point(10, 0), point(10, 0)])).toBe(0);
  });
});

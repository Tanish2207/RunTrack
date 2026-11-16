import type { RoutePoint } from '../api/types';

/**
 * GPS distance math (spec §3.3). Pure functions — no I/O, no Date.now().
 * Used at 2–3 Hz on the live HUD, so keep allocation-light.
 */
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two WGS84 points, in kilometers. */
export function getDistanceFromLatLonInKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  // Floating-point drift at antipodes can otherwise make sqrt(1 - a) NaN.
  const bounded = Math.min(1, Math.max(0, a));
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

/** Total distance of a route: haversine summed over consecutive points. */
export function computeDistanceKm(points: readonly RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    total += getDistanceFromLatLonInKm(prev.lat, prev.lng, curr.lat, curr.lng);
  }
  return total;
}

/** Never charge movement during a pause as distance between two segments. */
export function computeSegmentDistanceKm(
  segments: readonly (readonly RoutePoint[])[],
): number {
  let total = 0;
  for (const segment of segments) total += computeDistanceKm(segment);
  return total;
}

/** Last recorded fix, including when a freshly resumed segment is still empty. */
export function lastRoutePoint(
  segments: readonly (readonly RoutePoint[])[],
): RoutePoint | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.length > 0) return segment[segment.length - 1];
  }
  return null;
}

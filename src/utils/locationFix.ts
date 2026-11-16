import type { RoutePoint } from '../api/types';
import { getDistanceFromLatLonInKm } from './geo';

/** Structural input keeps filtering testable without loading a native module. */
export interface GpsFix {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
  };
}

export const MAX_GPS_ACCURACY_METERS = 20;
export const MAX_TRACKING_SPEED_MPS = 28;
export const MAX_FIX_AGE_MS = 15_000;
const MAX_FUTURE_FIX_MS = 5_000;

export type FixRejection = 'coordinates' | 'accuracy' | 'timestamp' | 'teleport';
export type FilteredFix =
  | { accepted: true; point: RoutePoint }
  | { accepted: false; reason: FixRejection };

/** Last accepted point must be from THIS segment; a pause resets the baseline. */
export function filterLocationFix(
  fix: GpsFix,
  previous: RoutePoint | null,
  segmentStartedAt: number,
  now: number,
): FilteredFix {
  const { latitude: lat, longitude: lng, accuracy, speed } = fix.coords;
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180
  ) return { accepted: false, reason: 'coordinates' };

  if (
    accuracy === null || !Number.isFinite(accuracy) ||
    accuracy < 0 || accuracy > MAX_GPS_ACCURACY_METERS
  ) return { accepted: false, reason: 'accuracy' };

  const { timestamp } = fix;
  if (
    !Number.isFinite(timestamp) || timestamp < segmentStartedAt ||
    now - timestamp > MAX_FIX_AGE_MS || timestamp - now > MAX_FUTURE_FIX_MS ||
    (previous !== null && timestamp <= previous.timestamp)
  ) return { accepted: false, reason: 'timestamp' };

  if (previous !== null) {
    const distanceMeters = getDistanceFromLatLonInKm(previous.lat, previous.lng, lat, lng) * 1000;
    const impliedSpeed = distanceMeters / ((timestamp - previous.timestamp) / 1000);
    if (impliedSpeed > MAX_TRACKING_SPEED_MPS) {
      return { accepted: false, reason: 'teleport' };
    }
  }

  const point: RoutePoint = { lat, lng, timestamp };
  // Providers use -1 for unavailable speed. Omit it, never write undefined.
  if (speed !== null && Number.isFinite(speed) && speed >= 0 && speed <= MAX_TRACKING_SPEED_MPS) {
    point.speed = speed;
  }
  return { accepted: true, point };
}

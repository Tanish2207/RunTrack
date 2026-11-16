import { describe, expect, it } from 'vitest';

import type { RoutePoint } from '../../api/types';
import {
  MAX_FIX_AGE_MS,
  MAX_GPS_ACCURACY_METERS,
  MAX_TRACKING_SPEED_MPS,
  filterLocationFix,
  type GpsFix,
} from '../locationFix';

const NOW = 100_000;
const SEGMENT_START = 50_000;

function fix(coords: Partial<GpsFix['coords']> = {}, timestamp = NOW): GpsFix {
  return {
    timestamp,
    coords: { latitude: 10, longitude: 20, accuracy: 5, speed: 3, ...coords },
  };
}

describe('filterLocationFix', () => {
  it('accepts an accurate valid GPS fix and stores only domain fields', () => {
    const input = { ...fix(), mocked: false, extra: true };
    expect(filterLocationFix(input, null, SEGMENT_START, NOW)).toEqual({
      accepted: true,
      point: { lat: 10, lng: 20, timestamp: NOW, speed: 3 },
    });
  });

  it.each([
    { latitude: Number.NaN }, { latitude: Number.POSITIVE_INFINITY },
    { longitude: Number.NEGATIVE_INFINITY }, { longitude: Number.NaN },
    { latitude: 90.0001 }, { latitude: -90.0001 },
    { longitude: 180.0001 }, { longitude: -180.0001 },
  ])('rejects invalid coordinates: %j', (coords) => {
    expect(filterLocationFix(fix(coords), null, SEGMENT_START, NOW)).toEqual({
      accepted: false, reason: 'coordinates',
    });
  });

  it.each([
    { latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 },
    { latitude: 0, longitude: 0 },
  ])('accepts coordinate boundaries: %j', (coords) => {
    expect(filterLocationFix(fix(coords), null, SEGMENT_START, NOW).accepted).toBe(true);
  });

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_GPS_ACCURACY_METERS + 0.1])(
    'rejects unavailable or inaccurate GPS accuracy: %s', (accuracy) => {
      expect(filterLocationFix(fix({ accuracy }), null, SEGMENT_START, NOW)).toEqual({
        accepted: false, reason: 'accuracy',
      });
    },
  );

  it.each([0, MAX_GPS_ACCURACY_METERS])('accepts inclusive accuracy boundaries: %s', (accuracy) => {
    expect(filterLocationFix(fix({ accuracy }), null, SEGMENT_START, NOW).accepted).toBe(true);
  });

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, MAX_TRACKING_SPEED_MPS + 1])(
    'omits unavailable/invalid native speed without losing a valid coordinate: %s', (speed) => {
      const result = filterLocationFix(fix({ speed }), null, SEGMENT_START, NOW);
      expect(result).toEqual({ accepted: true, point: { lat: 10, lng: 20, timestamp: NOW } });
      if (result.accepted) expect(result.point).not.toHaveProperty('speed');
    },
  );

  it.each([0, MAX_TRACKING_SPEED_MPS])('retains inclusive valid speed boundaries: %s', (speed) => {
    expect(filterLocationFix(fix({ speed }), null, SEGMENT_START, NOW)).toEqual({
      accepted: true, point: { lat: 10, lng: 20, timestamp: NOW, speed },
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, SEGMENT_START - 1, NOW - MAX_FIX_AGE_MS - 1, NOW + 5001])(
    'rejects invalid, pre-segment, stale, or too-far-future timestamps: %s', (timestamp) => {
      expect(filterLocationFix(fix({}, timestamp), null, SEGMENT_START, NOW)).toEqual({
        accepted: false, reason: 'timestamp',
      });
    },
  );

  it.each([NOW - MAX_FIX_AGE_MS, NOW + 5000])('accepts inclusive timestamp freshness boundaries: %s', (timestamp) => {
    expect(filterLocationFix(fix({}, timestamp), null, SEGMENT_START, NOW).accepted).toBe(true);
  });

  it('accepts a fix at segment start, including epoch zero', () => {
    expect(filterLocationFix(fix({}, 0), null, 0, 0).accepted).toBe(true);
  });

  it.each([NOW - 2000, NOW - 2001])('rejects duplicate and out-of-order accepted fixes: %s', (timestamp) => {
    const previous: RoutePoint = { lat: 10, lng: 20, timestamp: NOW - 2000 };
    expect(filterLocationFix(fix({}, timestamp), previous, SEGMENT_START, NOW)).toEqual({
      accepted: false, reason: 'timestamp',
    });
  });

  it('accepts plausible movement based on the last accepted fix', () => {
    const previous: RoutePoint = { lat: 10, lng: 20, timestamp: NOW - 2000 };
    expect(filterLocationFix(fix({ latitude: 10.00005 }), previous, SEGMENT_START, NOW).accepted).toBe(true);
  });

  it('rejects a teleport even when the provider reports a plausible speed', () => {
    const previous: RoutePoint = { lat: 10, lng: 20, timestamp: NOW - 2000, speed: 3 };
    expect(filterLocationFix(fix({ latitude: 11, speed: 3 }), previous, SEGMENT_START, NOW)).toEqual({
      accepted: false, reason: 'teleport',
    });
  });

  it('checks implied movement speed on both sides of the tracking limit', () => {
    const metersPerDegree = (6371 * Math.PI * 1000) / 180;
    const previous: RoutePoint = { lat: 0, lng: 0, timestamp: NOW - 2000 };
    const movingFix = (speed: number) => fix({ latitude: (speed * 2) / metersPerDegree, longitude: 0 });
    expect(filterLocationFix(movingFix(MAX_TRACKING_SPEED_MPS - 0.1), previous, SEGMENT_START, NOW).accepted).toBe(true);
    expect(filterLocationFix(movingFix(MAX_TRACKING_SPEED_MPS + 0.1), previous, SEGMENT_START, NOW)).toEqual({
      accepted: false, reason: 'teleport',
    });
  });

  it('resets the movement baseline for a newly resumed segment', () => {
    const prePause: RoutePoint = { lat: 10, lng: 20, timestamp: NOW - 2000 };
    const resumedFix = fix({ latitude: 11 });
    expect(filterLocationFix(resumedFix, prePause, SEGMENT_START, NOW).accepted).toBe(false);
    expect(filterLocationFix(resumedFix, null, NOW, NOW).accepted).toBe(true);
    expect(filterLocationFix(fix({}, NOW - 1), null, NOW, NOW)).toEqual({ accepted: false, reason: 'timestamp' });
  });

  it('does not mutate the native fix or the accepted baseline on rejection', () => {
    const previous = Object.freeze({ lat: 10, lng: 20, timestamp: NOW - 2000, speed: 3 });
    const input = Object.freeze({ timestamp: NOW, coords: Object.freeze(fix({ latitude: 11 }).coords) });
    expect(filterLocationFix(input, previous, SEGMENT_START, NOW).accepted).toBe(false);
    expect(previous).toEqual({ lat: 10, lng: 20, timestamp: NOW - 2000, speed: 3 });
    expect(input.coords.latitude).toBe(11);
  });
});

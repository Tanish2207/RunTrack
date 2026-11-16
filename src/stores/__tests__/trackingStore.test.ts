import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RoutePoint } from '../../api/types';
import { computeElapsedMs } from '../../utils/tracking';
import { useTrackingStore } from '../trackingStore';

const METERS_PER_DEGREE_LAT = (6371 * Math.PI * 1000) / 180;

function at(time: number): void {
  vi.setSystemTime(time);
}

function point(lat: number, timestamp: number): RoutePoint {
  return { lat, lng: 0, timestamp, speed: 3 };
}

beforeEach(() => {
  vi.useFakeTimers();
  at(0);
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
});

afterEach(() => {
  useTrackingStore.getState().reset();
  vi.useRealTimers();
});

describe('tracking state guards', () => {
  it('ignores pause, resume, append, and stop while idle', () => {
    const initial = useTrackingStore.getState();
    initial.pause();
    initial.resume();
    initial.appendPoint(point(0, 0));
    expect(initial.stop(70)).toBeNull();
    expect(useTrackingStore.getState()).toBe(initial);
  });

  it.each(['run', 'cycle', 'walk'] as const)('starts a %s session at epoch zero with a fresh segment', (activityType) => {
    useTrackingStore.getState().start(activityType);
    expect(useTrackingStore.getState()).toMatchObject({
      status: 'recording', activityType, segments: [[]], startedAt: 0,
      totalPausedMs: 0, pauseStartedAt: null, lastAnnouncedKm: 0, pendingSummary: null,
    });
  });

  it('cannot restart an already recording or paused session', () => {
    useTrackingStore.getState().start('walk');
    useTrackingStore.getState().appendPoint(point(0, 0));
    const recording = useTrackingStore.getState();
    at(10_000);
    recording.start('cycle');
    expect(useTrackingStore.getState()).toBe(recording);
    recording.pause();
    const paused = useTrackingStore.getState();
    at(20_000);
    paused.start('run');
    expect(useTrackingStore.getState()).toBe(paused);
  });

  it('does not move an existing pause timestamp on repeated pause', () => {
    useTrackingStore.getState().start('run');
    at(10_000);
    useTrackingStore.getState().pause();
    const paused = useTrackingStore.getState();
    at(20_000);
    paused.pause();
    expect(useTrackingStore.getState()).toBe(paused);
    expect(paused.pauseStartedAt).toBe(10_000);
  });

  it('creates just one new segment when resume is repeated', () => {
    useTrackingStore.getState().start('run');
    at(10_000);
    useTrackingStore.getState().pause();
    at(30_000);
    useTrackingStore.getState().resume();
    const resumed = useTrackingStore.getState();
    expect(resumed).toMatchObject({ status: 'recording', totalPausedMs: 20_000, pauseStartedAt: null, segments: [[], []] });
    at(40_000);
    resumed.resume();
    expect(useTrackingStore.getState()).toBe(resumed);
  });

  it('ignores paused fixes instead of charging paused movement as a route', () => {
    useTrackingStore.getState().start('run');
    useTrackingStore.getState().appendPoint(point(0, 0));
    useTrackingStore.getState().pause();
    const before = useTrackingStore.getState().segments;
    useTrackingStore.getState().appendPoint(point(40, 10_000));
    expect(useTrackingStore.getState().segments).toBe(before);
    expect(before).toEqual([[point(0, 0)]]);
  });

  it('does not overwrite a pending snapshot on another stop or start', () => {
    useTrackingStore.getState().start('walk');
    at(10_000);
    const snapshot = useTrackingStore.getState().stop(70);
    const finished = useTrackingStore.getState();
    expect(snapshot).not.toBeNull();
    at(20_000);
    expect(finished.stop(90)).toBeNull();
    finished.start('cycle');
    finished.pause();
    finished.resume();
    finished.appendPoint(point(30, 20_000));
    expect(useTrackingStore.getState()).toBe(finished);
    expect(finished.pendingSummary).toBe(snapshot);
    expect(finished.pendingSummary?.activityType).toBe('walk');
  });

  it('requires an explicit reset/discard before a new session may start', () => {
    useTrackingStore.getState().start('cycle');
    useTrackingStore.getState().setLastAnnouncedKm(4);
    at(10_000);
    useTrackingStore.getState().stop(70);
    useTrackingStore.getState().reset();
    expect(useTrackingStore.getState()).toMatchObject({
      status: 'idle', activityType: 'cycle', pendingSummary: null, segments: [], startedAt: null,
      pauseStartedAt: null, totalPausedMs: 0, lastAnnouncedKm: 0,
    });
    at(20_000);
    useTrackingStore.getState().start('run');
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', activityType: 'run', startedAt: 20_000 });
  });
});

describe('pause accounting and snapshots', () => {
  it('excludes every completed pause and the final still-open pause', () => {
    useTrackingStore.getState().start('run');
    at(10_000);
    useTrackingStore.getState().pause();
    at(30_000);
    useTrackingStore.getState().resume();
    at(40_000);
    useTrackingStore.getState().pause();
    at(50_000);
    useTrackingStore.getState().resume();
    at(70_000);
    useTrackingStore.getState().pause();
    at(100_000);
    expect(computeElapsedMs(useTrackingStore.getState(), Date.now())).toBe(40_000);
    const snapshot = useTrackingStore.getState().stop(70);
    expect(snapshot).toMatchObject({ startedAt: 0, endedAt: 100_000, durationSec: 40 });
    expect(useTrackingStore.getState()).toMatchObject({
      status: 'idle', startedAt: null, totalPausedMs: 0, pauseStartedAt: null, segments: [], pendingSummary: snapshot,
    });
  });

  it('handles an open pause that begins at epoch zero', () => {
    useTrackingStore.getState().start('run');
    useTrackingStore.getState().pause();
    at(60_000);
    expect(computeElapsedMs(useTrackingStore.getState(), Date.now())).toBe(0);
    expect(useTrackingStore.getState().stop(70)?.durationSec).toBe(0);
  });

  it('folds a pause starting at zero when resuming', () => {
    useTrackingStore.getState().start('walk');
    useTrackingStore.getState().pause();
    at(20_000);
    useTrackingStore.getState().resume();
    expect(useTrackingStore.getState().totalPausedMs).toBe(20_000);
    at(30_000);
    expect(useTrackingStore.getState().stop(70)?.durationSec).toBe(10);
  });

  it('clamps a backwards clock during resume instead of subtracting from paused time', () => {
    useTrackingStore.getState().start('run');
    at(10_000);
    useTrackingStore.getState().pause();
    at(5000);
    useTrackingStore.getState().resume();
    expect(useTrackingStore.getState().totalPausedMs).toBe(0);
  });

  it('defensively resumes a paused state with a missing pause timestamp', () => {
    useTrackingStore.getState().start('run');
    useTrackingStore.setState({ status: 'paused', pauseStartedAt: null, totalPausedMs: 3000 });
    at(10_000);
    useTrackingStore.getState().resume();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', totalPausedMs: 3000, segments: [[], []] });
  });

  it('updates route arrays immutably and retains previous segments on append', () => {
    useTrackingStore.getState().start('run');
    const initialSegments = useTrackingStore.getState().segments;
    useTrackingStore.getState().appendPoint(point(0, 0));
    expect(initialSegments).toEqual([[]]);
    const firstSegment = useTrackingStore.getState().segments[0];
    useTrackingStore.getState().pause();
    useTrackingStore.getState().resume();
    const beforeAppend = useTrackingStore.getState().segments;
    useTrackingStore.getState().appendPoint(point(40, 0));
    expect(beforeAppend[1]).toEqual([]);
    expect(useTrackingStore.getState().segments).not.toBe(beforeAppend);
    expect(useTrackingStore.getState().segments[0]).toBe(firstSegment);
    expect(firstSegment).toEqual([point(0, 0)]);
  });

  it('supports defensive append when a recording state has no segment', () => {
    useTrackingStore.getState().start('run');
    useTrackingStore.setState({ segments: [] });
    useTrackingStore.getState().appendPoint(point(0, 0));
    expect(useTrackingStore.getState().segments).toEqual([[point(0, 0)]]);
  });

  it('preserves pause breaks, excludes paused movement, and deep-copies source points on stop', () => {
    const a = point(0, 0);
    const b = point(0.001, 10_000);
    const c = point(40, 40_000);
    const d = point(40.001, 50_000);
    useTrackingStore.getState().start('cycle');
    useTrackingStore.getState().appendPoint(a);
    at(10_000);
    useTrackingStore.getState().appendPoint(b);
    useTrackingStore.getState().pause();
    at(20_000);
    useTrackingStore.getState().appendPoint(point(20, 20_000));
    at(40_000);
    useTrackingStore.getState().resume();
    useTrackingStore.getState().appendPoint(c);
    at(50_000);
    useTrackingStore.getState().appendPoint(d);
    const sourceSegments = useTrackingStore.getState().segments;
    at(60_000);
    const snapshot = useTrackingStore.getState().stop(80)!;
    const expectedDistanceKm = (2 * 0.001 * METERS_PER_DEGREE_LAT) / 1000;
    expect(snapshot.activityType).toBe('cycle');
    expect(snapshot.durationSec).toBe(30);
    expect(snapshot.distanceKm).toBeCloseTo(expectedDistanceKm, 9);
    expect(snapshot.avgPaceSecPerKm).toBe(Math.round(30 / expectedDistanceKm));
    expect(snapshot.caloriesEstimate).toBe(Math.round(expectedDistanceKm * 80 * 1.036 * 10) / 10);
    expect(snapshot.segments).toEqual([[a, b], [c, d]]);
    expect(snapshot.points).toEqual([a, b, c, d]);
    expect(snapshot.segments).not.toBe(sourceSegments);
    expect(snapshot.segments[0]).not.toBe(sourceSegments[0]);
    expect(snapshot.points[0]).not.toBe(a);
    expect(snapshot.segments[1][0]).not.toBe(c);
    a.lat = 80;
    c.speed = 20;
    sourceSegments[0].push(point(50, 60_000));
    useTrackingStore.getState().reset();
    useTrackingStore.getState().start('walk');
    expect(snapshot.points[0].lat).toBe(0);
    expect(snapshot.segments[1][0].speed).toBe(3);
    expect(snapshot.segments[0]).toHaveLength(2);
    expect(snapshot.activityType).toBe('cycle');
  });

  it('drops empty review segments and produces a valid zero-distance snapshot', () => {
    useTrackingStore.getState().start('walk');
    useTrackingStore.getState().pause();
    at(10_000);
    useTrackingStore.getState().resume();
    at(20_000);
    const snapshot = useTrackingStore.getState().stop(70);
    expect(snapshot).toMatchObject({ points: [], segments: [], distanceKm: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0, durationSec: 10 });
  });

  it('resets voice-coach progress after stopping', () => {
    useTrackingStore.getState().start('run');
    useTrackingStore.getState().setLastAnnouncedKm(5);
    expect(useTrackingStore.getState().lastAnnouncedKm).toBe(5);
    useTrackingStore.getState().stop(70);
    expect(useTrackingStore.getState().lastAnnouncedKm).toBe(0);
  });
});

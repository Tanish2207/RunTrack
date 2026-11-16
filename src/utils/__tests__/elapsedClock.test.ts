import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElapsedClock } from '../elapsedClock';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('elapsed clock', () => {
  it('keeps snapshot reads cached and starts no timer before subscription', () => {
    const clock = createElapsedClock();
    expect(clock.getSnapshot()).toBe(1000);
    vi.setSystemTime(20_000);
    expect(clock.getSnapshot()).toBe(1000);
    expect(clock.getSnapshot()).toBe(clock.getSnapshot());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes immediately when a view subscribes, not one second later', () => {
    const clock = createElapsedClock();
    const onTick = vi.fn();
    vi.setSystemTime(20_000);
    const unsubscribe = clock.subscribe(onTick);
    expect(clock.getSnapshot()).toBe(20_000);
    expect(onTick).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    unsubscribe();
  });

  it('publishes actual wall time every second', () => {
    const clock = createElapsedClock();
    const values: number[] = [];
    const unsubscribe = clock.subscribe(() => values.push(clock.getSnapshot()));
    vi.advanceTimersByTime(2500);
    expect(values).toEqual([1000, 2000, 3000]);
    expect(clock.getSnapshot()).toBe(3000);
    unsubscribe();
  });

  it('does not accumulate tick counts after a delayed timer or wall-clock jump', () => {
    const clock = createElapsedClock();
    const unsubscribe = clock.subscribe(vi.fn());
    vi.setSystemTime(60_000);
    vi.advanceTimersByTime(1000);
    expect(clock.getSnapshot()).toBe(61_000);
    unsubscribe();
  });

  it('removes its interval and stops publishing after cleanup', () => {
    const clock = createElapsedClock();
    const onTick = vi.fn();
    const unsubscribe = clock.subscribe(onTick);
    vi.advanceTimersByTime(1000);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(clock.getSnapshot()).toBe(2000);
  });

  it('catches up immediately after pause or a hidden view unsubscribes', () => {
    const clock = createElapsedClock();
    const first = clock.subscribe(vi.fn());
    vi.advanceTimersByTime(1000);
    first();
    vi.advanceTimersByTime(30_000);
    const onTick = vi.fn();
    const second = clock.subscribe(onTick);
    expect(clock.getSnapshot()).toBe(32_000);
    expect(onTick).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    second();
  });

  it('permits repeated cleanup without leaving an interval', () => {
    const unsubscribe = createElapsedClock().subscribe(vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispose or update another view clock', () => {
    const first = createElapsedClock();
    const second = createElapsedClock();
    const stopFirst = first.subscribe(vi.fn());
    const secondTick = vi.fn();
    const stopSecond = second.subscribe(secondTick);
    stopFirst();
    vi.advanceTimersByTime(2000);
    expect(first.getSnapshot()).toBe(1000);
    expect(second.getSnapshot()).toBe(3000);
    expect(secondTick).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    stopSecond();
  });
});

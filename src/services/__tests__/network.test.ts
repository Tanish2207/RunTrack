import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isInternetLikelyReachable } from '../network';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@react-native-community/netinfo', () => ({ default: { fetch: mocks.fetch } }));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isInternetLikelyReachable', () => {
  it.each([
    { reachability: false, expected: false },
    { reachability: true, expected: true },
    { reachability: null, expected: true },
    { reachability: undefined, expected: true },
  ])('maps isInternetReachable $reachability to $expected', async ({ reachability, expected }) => {
    mocks.fetch.mockResolvedValue({ isInternetReachable: reachability });
    await expect(isInternetLikelyReachable()).resolves.toBe(expected);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it('propagates a failed reachability probe', async () => {
    const failure = new Error('probe failed');
    mocks.fetch.mockRejectedValue(failure);
    await expect(isInternetLikelyReachable()).rejects.toBe(failure);
  });
});

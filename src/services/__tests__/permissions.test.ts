import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationPermissionResponse } from 'expo-location';

import { ensureForegroundLocation, getForegroundLocationPermission, openLocationSettings } from '../permissions';

const mocks = vi.hoisted(() => ({
  getForegroundPermissionsAsync: vi.fn<() => Promise<LocationPermissionResponse>>(),
  requestForegroundPermissionsAsync: vi.fn<() => Promise<LocationPermissionResponse>>(),
  requestBackgroundPermissionsAsync: vi.fn<() => Promise<LocationPermissionResponse>>(),
  openSettings: vi.fn<() => Promise<void>>(),
  platform: { OS: 'ios' },
}));

vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: mocks.getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync: mocks.requestForegroundPermissionsAsync,
  requestBackgroundPermissionsAsync: mocks.requestBackgroundPermissionsAsync,
}));
vi.mock('react-native', () => ({ Linking: { openSettings: mocks.openSettings }, Platform: mocks.platform }));

function permission(granted: boolean, canAskAgain = true): LocationPermissionResponse {
  return {
    granted, canAskAgain, expires: 'never',
    status: (granted ? 'granted' : 'denied') as LocationPermissionResponse['status'],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const accuracyCases: {
  name: string;
  platform: 'android' | 'ios';
  details: Pick<LocationPermissionResponse, 'android' | 'ios'>;
  result: 'granted' | 'blocked';
}[] = [
  { name: 'Android fine', platform: 'android', details: { android: { accuracy: 'fine' } }, result: 'granted' },
  { name: 'Android coarse', platform: 'android', details: { android: { accuracy: 'coarse' } }, result: 'blocked' },
  { name: 'Android none', platform: 'android', details: { android: { accuracy: 'none' } }, result: 'blocked' },
  { name: 'iOS full', platform: 'ios', details: { ios: { accuracy: 'full', scope: 'whenInUse' } }, result: 'granted' },
  { name: 'iOS reduced', platform: 'ios', details: { ios: { accuracy: 'reduced', scope: 'whenInUse' } }, result: 'blocked' },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.platform.OS = 'ios';
  mocks.getForegroundPermissionsAsync.mockResolvedValue(permission(false));
  mocks.requestForegroundPermissionsAsync.mockResolvedValue(permission(true));
  mocks.openSettings.mockResolvedValue(undefined);
});

describe('ensureForegroundLocation', () => {
  it('reuses an existing grant without requesting more permissions', async () => {
    mocks.getForegroundPermissionsAsync.mockResolvedValue(permission(true, false));
    await expect(ensureForegroundLocation()).resolves.toBe('granted');
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each(accuracyCases)('maps an existing $name grant to $result without prompting', async ({ platform, details, result }) => {
    mocks.platform.OS = platform;
    mocks.getForegroundPermissionsAsync.mockResolvedValue({ ...permission(true), ...details });
    await expect(ensureForegroundLocation()).resolves.toBe(result);
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each(accuracyCases)('maps a prompted $name grant to $result', async ({ platform, details, result }) => {
    mocks.platform.OS = platform;
    mocks.requestForegroundPermissionsAsync.mockResolvedValue({ ...permission(true), ...details });
    await expect(ensureForegroundLocation()).resolves.toBe(result);
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests foreground access only when the OS allows another prompt', async () => {
    await expect(ensureForegroundLocation()).resolves.toBe('granted');
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns blocked without prompting an already blocked permission', async () => {
    mocks.getForegroundPermissionsAsync.mockResolvedValue(permission(false, false));
    await expect(ensureForegroundLocation()).resolves.toBe('blocked');
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each([[true, 'denied'], [false, 'blocked']] as const)('maps a refused prompt with canAskAgain=%s to %s', async (canAskAgain, result) => {
    mocks.requestForegroundPermissionsAsync.mockResolvedValue(permission(false, canAskAgain));
    await expect(ensureForegroundLocation()).resolves.toBe(result);
  });

  it('coalesces overlapping checks and prompts into the exact same promise', async () => {
    const check = deferred<LocationPermissionResponse>();
    const prompt = deferred<LocationPermissionResponse>();
    mocks.getForegroundPermissionsAsync.mockReturnValue(check.promise);
    mocks.requestForegroundPermissionsAsync.mockReturnValue(prompt.promise);
    const focusRequest = ensureForegroundLocation();
    const startRequest = ensureForegroundLocation();
    expect(startRequest).toBe(focusRequest);
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    check.resolve(permission(false));
    await Promise.resolve();
    expect(ensureForegroundLocation()).toBe(focusRequest);
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    prompt.resolve(permission(true));
    await expect(focusRequest).resolves.toBe('granted');
    await expect(startRequest).resolves.toBe('granted');
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('rechecks OS state and permits retry after a denied request', async () => {
    mocks.requestForegroundPermissionsAsync.mockResolvedValueOnce(permission(false));
    await expect(ensureForegroundLocation()).resolves.toBe('denied');
    await expect(ensureForegroundLocation()).resolves.toBe('granted');
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
  });

  it('does not cache a blocked result after the user changes Settings', async () => {
    mocks.getForegroundPermissionsAsync.mockResolvedValueOnce(permission(false, false));
    await expect(ensureForegroundLocation()).resolves.toBe('blocked');
    mocks.getForegroundPermissionsAsync.mockResolvedValueOnce(permission(true));
    await expect(ensureForegroundLocation()).resolves.toBe('granted');
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each(['check', 'prompt'] as const)('propagates an OS %s error, releases coalescing, and allows retry', async (stage) => {
    const failure = new Error('native permission error');
    if (stage === 'check') mocks.getForegroundPermissionsAsync.mockRejectedValueOnce(failure);
    else mocks.requestForegroundPermissionsAsync.mockRejectedValueOnce(failure);
    const first = ensureForegroundLocation();
    const second = ensureForegroundLocation();
    expect(second).toBe(first);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    await expect(ensureForegroundLocation()).resolves.toBe('granted');
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
  });
});

describe('getForegroundLocationPermission', () => {
  it.each([[true, true, 'granted'], [false, true, 'denied'], [false, false, 'blocked']] as const)(
    'reads granted=%s, canAskAgain=%s as %s without showing a prompt',
    async (granted, canAskAgain, result) => {
      mocks.getForegroundPermissionsAsync.mockResolvedValue(permission(granted, canAskAgain));
      await expect(getForegroundLocationPermission()).resolves.toBe(result);
      expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
      expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    },
  );

  it.each(accuracyCases)('reads $name access as $result without prompting', async ({ platform, details, result }) => {
    mocks.platform.OS = platform;
    mocks.getForegroundPermissionsAsync.mockResolvedValue({ ...permission(true, false), ...details });
    await expect(getForegroundLocationPermission()).resolves.toBe(result);
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it.each(accuracyCases.filter(({ result }) => result === 'blocked'))(
    'recovers from $name access after precise location is enabled in Settings',
    async ({ platform, details }) => {
      mocks.platform.OS = platform;
      mocks.getForegroundPermissionsAsync.mockResolvedValueOnce({ ...permission(true), ...details });
      await expect(getForegroundLocationPermission()).resolves.toBe('blocked');
      await openLocationSettings();
      const precise: Pick<LocationPermissionResponse, 'android' | 'ios'> = platform === 'android'
        ? { android: { accuracy: 'fine' } }
        : { ios: { accuracy: 'full', scope: 'whenInUse' } };
      mocks.getForegroundPermissionsAsync.mockResolvedValueOnce({ ...permission(true), ...precise });
      await expect(getForegroundLocationPermission()).resolves.toBe('granted');
      expect(mocks.openSettings).toHaveBeenCalledOnce();
      expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
      expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    },
  );

  it('propagates a read failure and rechecks on the next read without prompting', async () => {
    const failure = new Error('permission read failed');
    mocks.getForegroundPermissionsAsync.mockRejectedValueOnce(failure);
    await expect(getForegroundLocationPermission()).rejects.toBe(failure);
    await expect(getForegroundLocationPermission()).resolves.toBe('denied');
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(mocks.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('joins an explicit pending permission request without another prompt or a stale OS read', async () => {
    const prompt = deferred<LocationPermissionResponse>();
    mocks.requestForegroundPermissionsAsync.mockReturnValueOnce(prompt.promise);
    const request = ensureForegroundLocation();
    await Promise.resolve();
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    const read = getForegroundLocationPermission();
    expect(read).toBe(request);
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledOnce();
    expect(mocks.requestForegroundPermissionsAsync).toHaveBeenCalledOnce();
    prompt.resolve(permission(true));
    await expect(request).resolves.toBe('granted');
    await expect(read).resolves.toBe('granted');
    mocks.getForegroundPermissionsAsync.mockResolvedValueOnce(permission(true));
    await expect(getForegroundLocationPermission()).resolves.toBe('granted');
    expect(mocks.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('openLocationSettings', () => {
  it.each(['ios', 'android'])('opens native settings on %s', async (platform) => {
    mocks.platform.OS = platform;
    await expect(openLocationSettings()).resolves.toBeUndefined();
    expect(mocks.openSettings).toHaveBeenCalledOnce();
  });

  it('propagates a native settings failure to the caller', async () => {
    const failure = new Error('could not open settings');
    mocks.openSettings.mockRejectedValue(failure);
    await expect(openLocationSettings()).rejects.toBe(failure);
  });

  it('gives web users browser-settings guidance without calling a native API', async () => {
    mocks.platform.OS = 'web';
    await expect(openLocationSettings()).rejects.toThrow('browser’s site settings');
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });
});

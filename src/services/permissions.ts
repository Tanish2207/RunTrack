import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

export type ForegroundLocationPermission = 'granted' | 'denied' | 'blocked';
let permissionRequest: Promise<ForegroundLocationPermission> | null = null;

function permissionResult(response: Location.LocationPermissionResponse): ForegroundLocationPermission {
  if (response.granted) {
    // Approximate access cannot pass the engine's 20m accuracy filter.
    if ((response.android && response.android.accuracy !== 'fine') || response.ios?.accuracy === 'reduced') return 'blocked';
    return 'granted';
  }
  return response.canAskAgain ? 'denied' : 'blocked';
}

/** Re-check on focus/return from Settings without repeatedly showing a prompt. */
export function getForegroundLocationPermission(): Promise<ForegroundLocationPermission> {
  // Returning from an OS prompt can emit `active` before its result resolves.
  // Join that request rather than letting an older OS read hide the new grant.
  return permissionRequest ?? Location.getForegroundPermissionsAsync().then(permissionResult);
}

/** Coalesce overlapping focus/Start requests; never ask for background access. */
export function ensureForegroundLocation(): Promise<ForegroundLocationPermission> {
  if (permissionRequest) return permissionRequest;
  const request = (async () => {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.granted || !existing.canAskAgain) return permissionResult(existing);
    return permissionResult(await Location.requestForegroundPermissionsAsync());
  })();
  permissionRequest = request;
  void request.finally(() => {
    if (permissionRequest === request) permissionRequest = null;
  }).catch(() => undefined);
  return request;
}

export async function openLocationSettings(): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Allow location in your browser’s site settings, then try again.');
  }
  await Linking.openSettings();
}

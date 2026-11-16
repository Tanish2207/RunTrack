import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  ensureForegroundLocation,
  getForegroundLocationPermission,
  type ForegroundLocationPermission,
} from '../services/permissions';
import { useUiStore } from '../stores/uiStore';

/** Ask once on first focus; later focus/Settings returns only check access. */
export function useForegroundLocation() {
  const [permission, setPermission] = useState<ForegroundLocationPermission | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const firstFocus = useRef(true);
  const sequence = useRef(0);

  const load = useCallback(async (request: boolean) => {
    if (!focused.current) return;
    const token = ++sequence.current;
    setChecking(true);
    setError(null);
    try {
      const result = await (request ? ensureForegroundLocation() : getForegroundLocationPermission());
      if (focused.current && token === sequence.current) setPermission(result);
    } catch {
      if (focused.current && token === sequence.current) {
        const message = 'Could not check location access. Try again.';
        setPermission(null);
        setError(message);
        useUiStore.getState().showToast(message, 'error');
      }
    } finally {
      if (focused.current && token === sequence.current) setChecking(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load(firstFocus.current);
    firstFocus.current = false;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(false);
    });
    return () => {
      focused.current = false;
      sequence.current++;
      listener.remove();
    };
  }, [load]));

  const refresh = useCallback(() => load(true), [load]);
  const recheck = useCallback(() => load(false), [load]);
  return { permission, checking, error, refresh, recheck };
}

/**
 * Single Firebase entry point. No Firebase config is duplicated across files —
 * every screen, store, and service imports its instances from here:
 *
 *   import { auth, db } from './firebase';
 *
 * Config values come from the merged Expo config (`app.config.js` combining
 * app.json placeholders with the git-ignored firebase.local.json), read through
 * expo-constants (`Constants.expoConfig.extra`). Until the placeholders are
 * replaced (see docs/FIREBASE_SETUP.md), instances can initialize for the UI
 * preview, but repositories reject network operations via the guard below.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * firebase 13.3.0 exports `getReactNativePersistence` at runtime through the
 * SDK's `react-native` condition (which Metro resolves — the `@firebase/auth`
 * RN build exports it), but the package's `types` barrel omits it, so the
 * plain import fails `tsc`. Augment the module's types with the documented
 * runtime signature (see firebase docs: "Authenticate in React Native") so
 * the call below stays strict-safe instead of relying on `any`.
 */
type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

declare module 'firebase/auth' {
  export function getReactNativePersistence(
    storage: AsyncStorageLike,
  ): Persistence;
}

/** Marker string used by the app.json placeholders (docs/FIREBASE_SETUP.md). */
const PLACEHOLDER_MARKER = 'PASTE_';

/** Read `source[key]` from an unknown shape without trusting manifest types. */
function readValue(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** Read `source[key]` as a string; anything else (or missing) degrades to ''. */
function readString(source: unknown, key: string): string {
  const value = readValue(source, key);
  return typeof value === 'string' ? value.trim() : '';
}

const rawFirebaseConfig: unknown = readValue(
  Constants.expoConfig?.extra,
  'firebase',
);

const firebaseOptions: FirebaseOptions = {
  apiKey: readString(rawFirebaseConfig, 'apiKey'),
  authDomain: readString(rawFirebaseConfig, 'authDomain'),
  projectId: readString(rawFirebaseConfig, 'projectId'),
  storageBucket: readString(rawFirebaseConfig, 'storageBucket'),
  messagingSenderId: readString(rawFirebaseConfig, 'messagingSenderId'),
  appId: readString(rawFirebaseConfig, 'appId'),
};

const unconfiguredFields = Object.entries(firebaseOptions)
  .filter(([, value]) => !value || value.includes(PLACEHOLDER_MARKER))
  .map(([key]) => key);

export class FirebaseConfigurationError extends Error {
  readonly code = 'runtrack/firebase-not-configured';

  constructor() {
    super('Firebase is not configured yet. Add your project values in firebase.local.json (see docs/FIREBASE_SETUP.md), then restart the dev server.');
    this.name = 'FirebaseConfigurationError';
  }
}

/** Fail before a network request; never pretend placeholder config can save. */
export function assertFirebaseConfigured(): void {
  if (unconfiguredFields.length > 0) throw new FirebaseConfigurationError();
}

if (__DEV__) {
  const values = Object.values(firebaseOptions);
  if (values.some((value) => value.includes(PLACEHOLDER_MARKER))) {
    console.warn(
      '[firebase] expo.extra.firebase still contains PASTE_ placeholders — follow docs/FIREBASE_SETUP.md to finish configuration.',
    );
  } else if (values.some((value) => value === '')) {
    console.warn(
      '[firebase] expo.extra.firebase is missing values — follow docs/FIREBASE_SETUP.md to finish configuration.',
    );
  }
}

/**
 * The single Firebase app instance. Reuses the existing app when the module is
 * re-evaluated (Fast Refresh / HMR) instead of throwing `app/duplicate-app`.
 */
export const firebaseApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp({
      ...firebaseOptions,
      // Firebase validates these at initialization. Missing config must not
      // crash the preview; the guard still rejects every repository operation.
      apiKey: firebaseOptions.apiKey || 'PASTE_FIREBASE_API_KEY',
      projectId: firebaseOptions.projectId || 'PASTE_PROJECT_ID',
    });

/**
 * Auth with AsyncStorage-backed LOCAL persistence configured at init time
 * (spec §3.1 — the session survives app restarts; #007 relies on this).
 * `initializeAuth` throws `auth/already-initialized` if the module is
 * re-evaluated during Fast Refresh; the fallback returns the existing
 * instance, whose persistence was configured on first init.
 */
export const auth: Auth = (() => {
  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(firebaseApp);
  }
})();

/** Cloud Firestore instance for all reads/writes (runtrack collections). */
export const db: Firestore = getFirestore(firebaseApp);

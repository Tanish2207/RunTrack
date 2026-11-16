/**
 * Auth service (tickets #004/#006/#007, spec §3.1) — the ONLY module screens
 * use for Firebase Auth and the `users/{uid}` profile doc. Screens never
 * import `firebase/auth` / `firebase/firestore` directly; they call these
 * functions and map error codes via src/utils/authErrors.ts.
 *
 * All functions let Firebase errors propagate to the caller EXCEPT where noted
 * (logout / bootstrap), so Login (#007) and Signup (#006) can render inline
 * field errors from `mapFirebaseAuthError`. Nothing here may hang forever:
 * `bootstrapAuth` carries a safety timer so the auth gate always resolves.
 */

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { auth } from './firebase';
import type { AuthUser } from './types';
import { ensureUserProfile } from './users';
import { useAuthStore } from '../stores/authStore';
import { useTrackingStore } from '../stores/trackingStore';
import { useSyncStore } from '../stores/syncStore';

export { ensureUserProfile } from './users';

const DEFAULT_WEIGHT_KG = 70;

/**
 * Bounded wait before the auth gate force-resolves. Placeholder Firebase
 * config / offline device can stall (or reject) every network call; the gate
 * must never spin past this.
 */
const BOOTSTRAP_SAFETY_MS = 8_000;

/** Dev-only synthetic identity (#004 preview toggle, removed in #028). */
const DEV_UID = 'dev-user';
const DEV_EMAIL = 'dev@runtrack.local';

/* ------------------------------------------------------------------ */
/* Auth actions (errors propagate — screens map codes to fields)       */
/* ------------------------------------------------------------------ */

/**
 * Create the Auth account AND the matching `users/{uid}` doc in one flow
 * (#006), then seed the stores so the root navigator flips to Main.
 */
export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthUser> {
  const cleanEmail = email.trim().toLowerCase();
  const credential = await createUserWithEmailAndPassword(
    auth,
    cleanEmail,
    password,
  );
  const user: AuthUser = { uid: credential.user.uid, email: credential.user.email };

  const profile = await ensureUserProfile(user.uid, { name, email: cleanEmail });
  useAuthStore.setState({ user });
  useAuthStore.getState().setProfile(profile);
  return user;
}

/** Sign in, load (or create) the profile doc, and seed the stores (#007). */
export async function signIn(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  const credential = await signInWithEmailAndPassword(
    auth,
    cleanEmail,
    password,
  );
  const profile = await ensureUserProfile(credential.user.uid, {
    email: cleanEmail,
  });
  useAuthStore.setState({
    user: { uid: credential.user.uid, email: credential.user.email },
  });
  useAuthStore.getState().setProfile(profile);
}

/**
 * Defensive local cleanup — a run and its sync queue must never survive
 * logout (spec §3.1). syncStore exposes no reset action, so every field it
 * publishes is zeroed directly.
 */
function clearLocalSession(): void {
  useAuthStore.getState().clear();
  useTrackingStore.getState().reset();
  useSyncStore.setState({ pendingCount: 0, syncInProgress: false });
}

/**
 * Sign out everywhere: Firebase Auth (best-effort — with placeholder config
 * the network call may fail, but the local session must still be dropped)
 * plus all global stores. #022's Profile screen calls this.
 */
export async function logout(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    if (__DEV__) {
      console.warn('[auth] signOut failed — clearing local session anyway', error);
    }
  } finally {
    clearLocalSession();
  }
}

/* ------------------------------------------------------------------ */
/* Session bootstrap (#007)                                            */
/* ------------------------------------------------------------------ */

let bootstrapStarted = false;
let bootstrapSafetyTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Resolve the auth gate WITHOUT wiping a signed-in user (the store has no
 * dedicated action; `clear()` would null the user we just set).
 */
function finishBootstrapping(): void {
  if (bootstrapSafetyTimer !== null) {
    clearTimeout(bootstrapSafetyTimer);
    bootstrapSafetyTimer = null;
  }
  useAuthStore.setState({ initializing: false });
}

/**
 * Subscribe to Firebase auth state ONCE (idempotent — safe under StrictMode
 * double effects). On the first callback the gate resolves:
 *   signed in  → setUser, then load/create the profile (async, non-blocking
 *                for the gate; on failure profile stays null)
 *   signed out → clear() (drops user + profile, initializing = false)
 *
 * A safety timer guarantees `initializing: false` even if Firebase never
 * answers (placeholder keys, offline device) — nothing hangs on cold start.
 */
export function bootstrapAuth(): void {
  if (bootstrapStarted) return;
  bootstrapStarted = true;

  bootstrapSafetyTimer = setTimeout(finishBootstrapping, BOOTSTRAP_SAFETY_MS);

  onAuthStateChanged(auth, (fbUser) => {
    if (!fbUser) {
      useAuthStore.getState().clear(); // also sets initializing: false
      finishBootstrapping(); // clears the safety timer
      return;
    }

    useAuthStore.setState({ user: { uid: fbUser.uid, email: fbUser.email } });
    ensureUserProfile(fbUser.uid)
      .then((profile) => {
        useAuthStore.getState().setProfile(profile);
      })
      .catch((error) => {
        // Profile stays null; screens render defaults and #013 can sync later.
        if (__DEV__) console.warn('[auth] profile bootstrap failed', error);
      })
      .finally(finishBootstrapping);
  });
}

/* ------------------------------------------------------------------ */
/* Dev preview toggle (#004 — replaced by real auth in #007/#028)      */
/* ------------------------------------------------------------------ */

/**
 * __DEV__-only: synthetic signed-in session with a locally constructed
 * default profile — NO network calls — so the whole app is navigable before
 * real Firebase keys are pasted.
 */
export function devSignIn(): void {
  if (!__DEV__) return;
  useAuthStore.setState({
    user: { uid: DEV_UID, email: DEV_EMAIL },
    profile: {
      uid: DEV_UID,
      name: 'Dev Runner',
      email: DEV_EMAIL,
      weightKg: DEFAULT_WEIGHT_KG,
      createdAt: Date.now(),
      totalDistanceKm: 0,
      totalActivities: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: null,
      badges: [],
    },
    initializing: false,
  });
}

/** __DEV__-only: drop the synthetic session and return to the Auth stack. */
export function devSignOut(): void {
  if (!__DEV__) return;
  clearLocalSession();
}

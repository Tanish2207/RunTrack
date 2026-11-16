# 007 — Login screen + session persistence + logout

> **Milestone:** M1 · **Labels:** `auth` · **Depends on:** #002, #003, #005 · **Size:** M

## Summary

Build Login per spec §3.1/§6, and the session plumbing around it: auth state bootstrap on
app start (`onAuthStateChanged` → load `users/{uid}` into `authStore`), AsyncStorage-backed
session persistence (initialized in #003), and the `signOut` action that #022's Profile
screen will call.

## Tasks

- [x] `src/screens/auth/LoginScreen.tsx`: logo/app name header, email + password `TextField`s, `Button primary "Login"` with loading, "Don't have an account? Sign up" link. Inline validation (email format, password non-empty) before hitting Firebase.
- [x] Firebase error mapping → inline field errors: `auth/user-not-found` / `auth/wrong-password` / `auth/invalid-credential` → a combined "Incorrect email or password" under password; `auth/invalid-email` → email; `auth/network-request-failed` → toast. *(via shared `mapFirebaseAuthError`; `general` codes → error toast — never an Alert)*
- [x] `src/api/auth.ts` — `bootstrapAuth()`: *(pre-built during #004; verified by code read this session — idempotent subscribe, `ensureUserProfile` load-or-create, safety timer resolving `initializing`. Unchanged; #007 screen scope didn't touch it)*
  - Subscribe once via `onAuthStateChanged`; on user present → `getDoc(users/{uid})`; if doc missing, create defaults doc (idempotent `ensureUserProfile`, shared with #006/#013); `authStore.setUser/setProfile`; finally `initializing = false`.
- [x] Call `bootstrapAuth()` from the root layout mount effect (replaces #004's fake-user dev toggle usage for the real path; keep dev toggle working behind `__DEV__`). *(already wired — verified in `src/app/_layout.tsx`; the former `RootNavigator` was removed when Expo Router took over navigation)*
- [x] `logout()` in `src/api/auth.ts`: `signOut(auth)` + `authStore.clear()` + reset `trackingStore`/`syncStore` (defensive — a run should never survive logout). *(already implemented during #004; end-to-end proof deferred below)*
- [ ] Verify persistence: log in, fully kill the app, relaunch → still authenticated and Main renders without a Login flash. *(needs a real device run with a valid session — placeholder Firebase config is active; deferred to runtime verification)*

## Acceptance Criteria

- [ ] Valid credentials → Main app; wrong credentials → inline error, no crash, no alert dialog. *(both code paths implemented in LoginScreen; runtime proof needs real Firebase keys — placeholder config is active)*
- [ ] Cold-start with a persisted session lands directly in Main with profile loaded (name shows on Profile placeholder). *(device-verification deferred)*
- [ ] Cold-start signed-out lands on Login without flashing Main first (`initializing` gate). *(flash-free cold-start check deferred to runtime)*
- [ ] `logout()` returns app to Login and clears all global stores. *(logout() exists and is ready for #022's Profile UI; e2e proof deferred to runtime)*
- [ ] Loading states on every async path (bootstrap splash, login button). *(Login `Button loading` + guard implemented in #007; bootstrap gate pre-built in #004 — visual on-device check pending)*

## Implementation Notes

- Persistence init must happen at `initializeAuth` time in `src/api/firebase.ts` (#003) — do not re-initialize auth here.
- Profile load on bootstrap should be `getDoc` once (not `onSnapshot`) to keep cold start simple; #022 switches Profile to its own `onSnapshot` for live badge/streak updates.
- Guard `bootstrapAuth` against double-subscribe (e.g. React 18 StrictMode double effects in dev).

## Agent Log

- Fully replaced the #004 LoginScreen stub in `src/screens/auth/LoginScreen.tsx` with the real sign-in flow: client-side validation → `signIn(email.trim(), password)` with a loading + double-submit guard; success relies on the root auth gate in `src/app/_layout.tsx` (no manual navigation). Only file touched; nothing installed.
- Validation runs BEFORE any Firebase call — email regex `/^\S+@\S+\.\S+$/` and non-empty password — with inline errors under the exact field, cleared as the user edits that field. No `Alert` anywhere.
- Error paths via the shared `mapFirebaseAuthError` (src/utils/authErrors.ts): `email` field → inline under Email; `password` field (`user-not-found`/`wrong-password`/`invalid-credential`/`invalid-login-credentials`) → "Incorrect email or password." under Password; `general`/unknown codes → `showToast(message, 'error')` from `useUiStore`. Placeholder-config network failures fall into the safe default → toast, surfacing gracefully. Only mapping gap found: `auth/user-disabled` falls to the generic default toast (acceptable; reported, not edited).
- Retained the `__DEV__`-only "Dev sign-in" ghost `Button` (calls `devSignIn()`), restyled small + centered and pinned below the form, with a one-line comment marking it for removal in #028 cleanup.
- Layout: `KeyboardAvoidingView` wrapping `Screen scroll` (iOS `padding`; Android `undefined` since default adjustResize already handles the keyboard), form vertically centered so inline errors stay visible on small screens.
- `npx tsc --noEmit` → clean, 0 errors across the whole project.

### Reconciliation — 2026-11-16

- `bootstrapAuth()` is now called from the root layout (`src/app/_layout.tsx`) after the direct-React-Navigation `RootNavigator` was removed; profile loading remains the idempotent `ensureUserProfile()` and the 8-second safety gate is unchanged. `devSignIn()`/`devSignOut()` remain a `__DEV__`-only navigation preview with no Firebase-authenticated identity or backend persistence. Historical log retained; persistence/launch/logout runtime checks stay unchecked.

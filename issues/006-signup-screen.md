# 006 — Signup screen + `users/{uid}` doc creation

> **Milestone:** M1 · **Labels:** `auth`, `firestore` · **Depends on:** #002, #003, #005 · **Size:** M

## Summary

Build Signup per spec §3.1/§6: name, email, password (min 6), confirm-password; create the
Firebase Auth account **and** the matching `users/{uid}` Firestore document in one flow,
with inline field validation and proper loading/error handling.

## Tasks

- [x] `src/screens/auth/SignupScreen.tsx` using the UI kit: four `TextField`s (name, email, password, confirm-password, password secure), `Button primary "Create Account"` with loading state, "Already have an account? Log in" link to Login.
- [x] Client-side validation **before** any Firebase call, errors inline under each field:
  - name: non-empty; email: regex; password: `length >= 6`; confirm: matches password.
- [x] On submit: `createUserWithEmailAndPassword(auth, email, password)` → immediately create the `users/{uid}` doc with the full spec §4 shape: *(fulfilled by the shared `signUp()` service in `src/api/auth.ts`, which calls `ensureUserProfile()` in `src/api/users.ts` — a transaction that reads first and creates defaults only when the doc is absent; screens never import Firebase directly)*
  ```ts
  { uid, name, email, weightKg: 70, createdAt: serverTimestamp(),
    totalDistanceKm: 0, totalActivities: 0, currentStreak: 0,
    longestStreak: 0, lastActivityDate: null, badges: [] }
  ```
- [x] Map Firebase error codes to inline field errors: *(via `mapFirebaseAuthError`, READ-ONLY in `src/utils/authErrors.ts`)*
  `auth/email-already-in-use` → email field; `auth/invalid-email` → email; `auth/weak-password` → password; anything else → non-blocking toast.
- [x] On success: `authStore.setProfile(...)` and the root navigator (#004) switches to Main automatically. *(done inside `signUp()`; the screen performs no navigation)*
- [x] Wrap the whole submit in try/catch; `ActivityIndicator` on the button while in flight; disable double-submit. *(kit `Button loading` spinner + submitting guard)*

## Acceptance Criteria

- [x] Invalid inputs show inline errors and never hit Firebase.
- [ ] Valid signup creates both the Auth user and the `users/{uid}` doc with the exact spec §4 defaults (verify in console). — *unchecked: needs a device run with real Firebase keys (placeholder config is active; verify doc defaults in the Firebase console).*
- [ ] New user lands in the Main app without manually navigating. — *unchecked: gate flip is wired (store seeded by `signUp()`) but requires a device run to observe.*
- [ ] Existing email produces a clear inline error on the email field. — *unchecked: mapping is in place (`auth/email-already-in-use` → email inline), needs a device run against real Firebase to confirm.*
- [x] Button shows a spinner during the async work; no silent freezes; no `Alert.alert` for validation.

## Implementation Notes

- Auth-account creation and profile-doc creation are **not atomic**: `signUp()` awaits `ensureUserProfile()` after the Auth account exists. If profile creation fails, the error propagates to the screen (mapped to a non-blocking toast via `mapFirebaseAuthError` general codes); the Firebase SDK may keep the freshly created Auth account signed in, and #007's `bootstrapAuth()` re-runs the idempotent `ensureUserProfile()` defaults on the next launch. There is no rollback of the Auth account.
- Trim/lowercase email; keep `name` as typed (used for the initials avatar in #022).
- Password field never stored; only Auth handles it.

## Agent Log

- Replaced the #004 stub with the full Signup screen: `Screen scroll` + `KeyboardAvoidingView` (iOS `padding`, Android `height`), app-name/logo header, four `TextField`s (Full name / Email / Password / Confirm password), primary "Create Account" `Button` with `loading`, and a typed "Already have an account? Log in" link → `router.navigate('/(auth)/login')` (complete Router href; the old `navigate('Login')` route-name call is superseded).
- Validation before any Firebase call, per spec: name non-empty (trim), email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, password ≥ 6, confirm === password; each error renders inline under its field via `TextField error` and clears on edit of that field only.
- Submit calls `signUp(name.trim(), email.trim(), password)` guarded by a `submitting` state (loading spinner + disabled, plus an early-return re-entry guard); success relies on the store seeding inside `signUp()` so the #004 gate flips to Main with no manual navigation.
- Error paths: `mapFirebaseAuthError` — `name`/`email`/`password` codes set inline field errors; `general` (network/config/unknown, expected with the placeholder Firebase config) raises `showToast(message, 'error')` via `useUiStore`. No `Alert.alert` anywhere. No dev sign-in button here (Login-only per #004).
- No missing mappings needed in `src/utils/authErrors.ts` — its `AuthErrorField` covers everything the screen requires (left untouched, as instructed).
- `npx tsc --noEmit`: **clean, 0 errors** (whole project, including this file).

### Reconciliation — 2026-11-16

- Updated the submit flow description and failure note to match the implemented `signUp()` → `ensureUserProfile()` transaction: non-atomic Auth + profile creation, no rollback, idempotent bootstrap retry; and the Login link to the current `router.navigate('/(auth)/login')` href. The historical log above is retained verbatim; runtime acceptance stays unchecked.

# 003 — Firebase project setup + client config module

> **Milestone:** M1 · **Labels:** `firebase`, `infra` · **Depends on:** #001 · **Size:** M

> **State:** Client module present; real Firebase configuration, console setup, and device acceptance pending.

## Summary

Create the Firebase project and wire it into the app through one config module
(`src/api/firebase.ts`) that exports initialized `auth` and `db` instances. Covers
spec §9 checklist items 1–2 and the client half of item 4.

## Tasks

- [ ] Create Firebase project `runtrack` in the console.
  *User/account step; see `docs/FIREBASE_SETUP.md`. No console verification has been performed.*
- [ ] Enable **Email/Password** authentication (no other providers).
  *Console/account step; not verified.*
- [ ] Create **Cloud Firestore** and apply the intended rules/indexes (#008/#028). Any temporary development test mode must be locked down before real use/submission.
  *Database creation and rules/index deployment are not verified by local source or unit tests.*
- [ ] Register a **WEB app** in the Firebase project and copy its `firebaseConfig` values into `app.json` → `expo.extra.firebase`: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
  *All six fields still contain `PASTE_` placeholders. Android/iOS Firebase registrations are optional for future native integrations; this JS SDK setup does not consume `google-services.json` or `GoogleService-Info.plist`.*
- [ ] Provision Google Maps platform keys through #027: enable **Maps SDK for Android** and **Maps SDK for iOS** separately, then replace `androidGoogleMapsApiKey` / `iosGoogleMapsApiKey` in the `react-native-maps` entry of `expo.plugins`.
  *Restrict keys to the intended SDK and the real Android package + build SHA-1 / iOS bundle ID. Identifiers, signing/build setup, and real keys are still pending; `docs/FIREBASE_SETUP.md` covers the setup.*
- [x] `expo-constants` is installed and `src/api/firebase.ts` reads the one config object through `Constants.expoConfig?.extra?.firebase`, exporting `firebaseApp`, `auth`, and `db`.
- [x] The primary Auth initialization path calls `initializeAuth` with `getReactNativePersistence(AsyncStorage)` at module load, before auth flows use it (#007).
- [x] The source contains a `declare module 'firebase/auth'` augmentation for the installed SDK's `getReactNativePersistence` type-export gap; the adapter is not a plain no-shim import.
- [x] Export `FirebaseConfigurationError` / `assertFirebaseConfigured`; `users.ts` and `activities.ts` check config before their Firestore network operations.
- [ ] Smoke-test `auth`/`db` initialization in a compatible device/development build.
  *The existing `__DEV__` warning for placeholder/missing config is diagnostic, not a successful boot log or cloud connectivity test.*

## Acceptance Criteria

- [x] Centralized `auth` and `db` exports exist and pass strict typechecking.
- [ ] App boots with no Firebase initialization errors on the target native client/build.
  *No device boot was performed. Static typechecking and Android bundling cannot satisfy this criterion.*
- [x] AsyncStorage persistence is supplied at primary Auth initialization time, not lazily. Actual persisted-session behavior across app restarts remains a device check in #007/#028.
- [x] Firebase instances/config loading are centralized in `src/api/firebase.ts`.
- [x] User/activity repositories reject missing or `PASTE_` config before Firestore network operations; initialization-only fallbacks do not make a backend usable.
- [ ] Firebase console shows: Email/Password provider enabled, Firestore created.
  *Console/account step; not verified.*

## Implementation Notes

- Use the **modular JS SDK**: `initializeApp` comes from `firebase/app`, Auth APIs from `firebase/auth`, and `getFirestore` / `collection` from `firebase/firestore` (not `firebase/auth`). Do not add `@react-native-firebase/*` for this setup.
- The config loader trims unknown manifest values and detects empty strings / `PASTE_` markers. Missing `apiKey` and `projectId` receive obvious placeholders only when constructing the SDK app for local preview; the guard still validates the original config.
- **Guard scope is limited:** `users.ts` and `activities.ts` fail before Firestore operations, but `auth.ts` still calls Firebase Auth SDK methods without this guard. Do not claim all Auth calls fail locally before network access.
- `devSignIn()` / `devSignOut()` only construct/clear local preview state. A synthetic user is never a Firebase-authenticated backend identity and cannot establish rules authorization.
- Auth initialization has a `getAuth(firebaseApp)` fallback if `initializeAuth` throws; the catch is broad, not restricted to `auth/already-initialized`. Source wiring is not proof of successful native initialization or persisted sessions.
- Current config is literal `app.json` placeholders, not an implemented `.env` injection pipeline. A dynamic app-config/environment choice remains #027 work; `app.json` cannot evaluate environment variables itself.
- Store the **Anthropic API key later via Cloud Function secrets only** (#018) — never in this config.
- Reference: [Using Firebase](https://docs.expo.dev/guides/using-firebase.md). Native Firebase config downloads are not prerequisites for the registered web-app JS configuration.

## Agent Log

- Reconciled against `firebase.ts`, `auth.ts`, `users.ts`, `activities.ts`, and `app.json`; read SDK 58 reference, `llms.txt`, Firebase and Maps documentation. No source, credentials, dependencies, or cloud configuration changed in this reconciliation.
- Corrected historical claims about empty-option initialization, no-shim persistence typing, mandatory native registration/config downloads, and legacy Maps config locations. The current source uses initialization-only fallbacks, explicit module augmentation, and Maps config-plugin options.
- The initialized app is reused through `getApps()` / `getApp()`. Config warnings and repository guards make unfinished setup explicit; neither proves native boot or cloud readiness, and the Auth service is not fully config-guarded.
- The earlier reconciliation snapshot passed lint/typecheck. Latest verification 2026-11-16: `npx expo lint` clean and strict `npx tsc --noEmit` passes (the 12 Activity Detail hook/test lint errors it once reported were fixed during #015 integration); `npm test` passes 575 tests in 24 files.
- Real web-app values, provider/database console checks, live rules/index deployment, device boot, and persisted-session testing remain unperformed and unchecked.

# Firebase Setup — RunTrack

Keep the `PASTE_` placeholders in `app.json` until the user supplies real project
values. This checklist configures the **Firebase JS SDK**, not React Native
Firebase. See the [Expo Firebase guide](https://docs.expo.dev/guides/using-firebase.md).

`src/api/firebase.ts` supports UI preview initialization and warns in development
when configuration is incomplete. Missing `apiKey`/`projectId` use initialization-only
placeholders; `assertFirebaseConfigured()` makes user/activity repository operations
fail before Firestore requests. Save retains the review and reports failure—there is
no fake persistence. Auth actions still call the SDK and handle its errors. The
development preview identity is local only, not a Firebase-authenticated account.

## 1. Firebase project + services (console)

1. Create a project named **`runtrack`** in the [Firebase console](https://console.firebase.google.com/).
2. **Authentication → Sign-in method → enable Email/Password** (no other providers).
3. **Firestore Database → Create database**. Start with restrictive rules, then
   deploy this project's `firestore.rules` and `firestore.indexes.json` before
   testing. Do not leave a public test-mode database accessible.
4. Using an account authorized for that project, deploy the checked-in configuration:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <project-id>
   ```

   These are user-run setup steps, **not deployments already performed**. Wait for
   the `activities` index (`userId ASC`, `startTime DESC`) to finish building.
   Owner access and `aiSummary`-only activity updates are implemented in the rules;
   real two-account security tests and final hardening remain pending (#008/#028).

## 2. Register a web app (console)

1. Project settings → **Your apps → Add app → Web** (`</>`); give it a RunTrack
   nickname. Firebase Hosting is not required for the mobile app.
2. In that web app's **SDK setup and configuration**, select the config object
   and copy `firebaseConfig` for the next step. The `appId` must come from this
   registration, not a guessed Android/iOS app ID.
3. Android/iOS Firebase registrations are optional for this JS SDK setup.
   RunTrack does **not** read `google-services.json` or `GoogleService-Info.plist`,
   and no native Firebase config plugin is installed. Do not add service files
   merely to use Email/Password Auth or Firestore.

Native Maps restrictions separately need `expo.android.package` and
`expo.ios.bundleIdentifier`. Those identifiers are not yet set in `app.json`;
choose them before creating a native build (#027), for example `com.runtrack.app`.

## 3. Copy the web config into `app.json`

Copy the web app's console-issued values into `expo.extra.firebase`. The current
configuration guard requires all six fields below to be nonempty and placeholder-free.
Exact mapping:

| Firebase console value   | app.json field                          |
| ------------------------ | --------------------------------------- |
| `apiKey`                 | `expo.extra.firebase.apiKey`            |
| `authDomain`             | `expo.extra.firebase.authDomain`        |
| `projectId`              | `expo.extra.firebase.projectId`         |
| `storageBucket`          | `expo.extra.firebase.storageBucket`     |
| `messagingSenderId`      | `expo.extra.firebase.messagingSenderId` |
| `appId`                  | `expo.extra.firebase.appId`             |

Replace whole values, including `authDomain` and `storageBucket`; do not derive
the bucket suffix from the example placeholder. Use the exact console value.
Restart the dev server with `npx expo start --clear` after editing configuration.
Keep the guard in place—it checks completeness, not whether credentials are valid
or the current preview identity is authenticated.

## 4. Google Maps keys (SDK 58, #027)

1. In [Google Cloud Console](https://console.cloud.google.com/) → the project
   linked to Firebase → **APIs & Services → Credentials → Create credentials → API key**.
2. Enable **Maps SDK for Android**. Create an Android key restricted to that API,
   your real Android package, and the SHA-1 of the certificate signing the build
   being tested. Debug, internal, and Play-signed builds may use different certificates.
3. Enable **Maps SDK for iOS** separately. Create an iOS key restricted to that
   API and your real iOS bundle identifier. Do not reuse a platform-restricted
   Android key as the iOS key.
4. Replace the values in the existing **`react-native-maps` plugin entry** in
   `expo.plugins`:

   ```json
   [
     "react-native-maps",
     {
       "androidGoogleMapsApiKey": "PASTE_ANDROID_MAPS_KEY",
       "iosGoogleMapsApiKey": "PASTE_IOS_MAPS_KEY"
     }
   ]
   ```

   Do not add a duplicate plugin or use the obsolete `android.config.googleMaps`
   / `ios.config.googleMapsApiKey` paths. Follow the
   [v58 Maps setup](https://docs.expo.dev/versions/v58.0.0/sdk/map-view.md).

Plugin changes are baked into a new native binary, not an OTA update. Expo Go
can preview its bundled Maps module without applying your native key config;
that is not validation of your own binary's credentials. Web uses an informational
map fallback, not Google Maps.

Native identifiers, `eas.json`, and a development-build workflow remain #027 work.
Once configured (including `expo-dev-client` for a development-client profile),
build in the cloud with `npx eas-cli@latest build --profile development --platform android`
or the corresponding iOS profile. See
[build configuration](https://docs.expo.dev/build/eas-json.md). Do not hand-edit
generated `ios/` or `android/` projects.

Client Firebase identifiers and Maps keys are distributed with the app. API
restrictions and Firestore rules provide protection; hiding them in `.env` does
not make bundled values secret. If moving values out of source later, use a
dynamic `app.config.js`/`app.config.ts`; static `app.json` does not evaluate env expressions.

## 5. Keys that do NOT live here

- The **Anthropic API key is never stored in `app.json`**. It is a server-side
  secret for the Cloud Functions coaching feature (#018):

  ```bash
   npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY --project <project-id>
  ```

- Never include service-account credentials or any server secret in `expo.extra`,
  a client-side environment variable, or the mobile bundle.

## 6. Demo data seeding (walks, runs, rides)

For demos where physically recording is impractical, `scripts/seedActivities.mjs`
signs in with a real account and writes 7 realistic activities around Lodha
Luxuria/Majiwada (Thane) and VJTI/Five Gardens (Matunga) — Upvan Lake and
neighborhood walks, campus runs, and Thane creek / King Circle rides — spread
over the past two weeks. Routes are generated loops with GPS-style drift;
distance, duration, pace, calories, and route timestamps are mutually
consistent, and History/Detail/Maps render them like real recordings.

Run it **after** steps 1–6 above (real config in `app.json`, rules deployed):

```bash
node scripts/seedActivities.mjs --email you@example.com --password secret
node scripts/seedActivities.mjs --dry-run   # plan only, no auth, no writes
```

- Signing in requires an account created via the app's Sign Up screen.
- Seeding is idempotent: docs use fixed IDs (`seed-<uid>-<slug>`) and existing
  ones are skipped, so re-running never duplicates.
- Activities are create-only per `firestore.rules`; the client can never delete
  them. Remove demo data via the Firebase console by deleting docs whose IDs
  start with `seed-`.

## After replacing the placeholders — pending acceptance

- [ ] Launch on a device/simulator and create a **real** Email/Password account;
  verify `users/{uid}` and persistent sign-in after relaunch. Do not use the local
  development preview account to validate Firestore.
- [ ] Record and Save an activity; inspect owner, route, stats, and Timestamp
  fields in Firestore. Confirm the owner query works without an index error.
- [ ] Repeat access checks with two accounts and signed-out requests against
  the deployed rules; other-owner reads/writes and non-recap updates must fail.
- [ ] Test native Maps on each intended platform using its own rebuilt binary.
- [ ] Complete [TRACKING_QA.md](TRACKING_QA.md), recording device/build/date/evidence.

All of these checks remain unperformed. Passing lint, typecheck, mocked unit
tests, Expo Doctor, and Android Hermes export does **not** establish device boot,
native Maps behavior, successful authentication/persistence, or backend rule enforcement.

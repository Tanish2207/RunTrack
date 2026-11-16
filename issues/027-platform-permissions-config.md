# 027 — Platform config: permissions, Maps keys, keep-awake, app.json

> **Milestone:** M9 · **Labels:** `platform`, `config` · **Depends on:** #003, #010 · **Size:** S

> **State:** Pending overall. Config-plugin groundwork exists, but identifiers, key provisioning, development-build setup, and native runtime audit are not complete.

## Summary

Spec §8: make the Expo app config correct and honest — permission usage-description
strings on both platforms, the Google Maps API key wired for Android (and iOS Google
provider), and the foreground/background tracking decision from #010's spike actually
reflected in the config.

## Source-Verified Groundwork (not device acceptance)

- `app.json` uses `name: RunTrack`, `slug: runtrack`, and `scheme: runtrack`. `android.package` and `ios.bundleIdentifier` are not set; `eas.json` and the `expo-dev-client` dependency/build setup are absent.
- The `expo-location` config plugin supplies "RunTrack uses precise location to record your route while the app is open." Its Always permission options, iOS/Android background-location flags, and Android foreground-service flag are explicitly `false`.
- The `react-native-maps` plugin in `expo.plugins` has `androidGoogleMapsApiKey` / `iosGoogleMapsApiKey`, both still `PASTE_GOOGLE_MAPS_API_KEY`. The shared `RouteMap` requests the Google provider; real keys/native rendering have not been verified.
- `expo-font ~58.0.12` is a direct icon peer dependency and config plugin. This is groundwork, not a device font/rendering test.
- Foreground-only tracking is implemented in `src/services/locationTracking.ts`: the engine alone uses tagged `activateKeepAwakeAsync` / `deactivateKeepAwake`; app inactive/background pauses recording and explicit Resume is required. `trackingStore` is memory-only, so a process kill loses an unsaved run/review.

## Tasks

- [ ] Complete the app-config/native metadata audit:
  - Keep `name: RunTrack`, `slug: runtrack`, `scheme: runtrack`; finalize real `android.package` and `ios.bundleIdentifier` values (e.g. `com.runtrack.app`; this is an example, not a current assignment/registration).
  - **iOS:** verify the plugin-generated `NSLocationWhenInUseUsageDescription`; foreground-only builds must not enable Always/background location. Audit the actual generated usage descriptions/modes, including any unused library-added descriptions.
  - **Android:** verify the merged foreground location permissions (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`) and absence of unused background-location/foreground-service permissions. Plugin flags alone do not prove the merged manifest is correct.
  - TTS output needs no microphone/speech-recognition permission (spec §8); verify that no unused permission strings or requests ship.
- [ ] Enable **Maps SDK for Android** and **Maps SDK for iOS** separately; provision restricted platform keys and replace the Maps plugin placeholders in `expo.plugins`:
  - `androidGoogleMapsApiKey`: restrict to Maps SDK for Android and the real package + SHA-1 certificate fingerprint of each build being tested/released.
  - `iosGoogleMapsApiKey`: restrict to Maps SDK for iOS and the real bundle identifier.
- [ ] Decide key/config sourcing and record it in `docs/DECISIONS.md`: if using local environment values, wire a git-ignored environment source through dynamic `app.config.js`. Current `app.json` has literal placeholders and does not read environment variables.
- [ ] Set up the SDK-compatible development client (`npx expo install expo-dev-client`), `eas.json` development profiles, and the required EAS project/signing prerequisites. This setup has not been performed.
- [ ] Build/install the configured Android and iOS native test clients and record build/OS details. Use EAS per `AGENTS.md` (`npx eas-cli@latest build --platform <android|ios> --profile development` after setup/authorization); no cloud/native build or installation has been performed here.
- [ ] Validate the #010 **foreground-only** decision on real devices:
  - Keep-awake covers a full foreground run, including pauses/tab switches, and is released on Stop/reset/logout. The engine is the sole owner; screens must not acquire separate locks.
  - Inactive/background/screen-lock interruption pauses recording; returning requires explicit Resume. Do not claim GPS survives a locked/background interval.
  - Confirm/document process-restart behavior: unsaved tracking/review is lost; warm screen remounts are not process recovery.
  - Carry the limitation into #028's writeup: "RunTrack records only while open. Locking the phone or leaving the app pauses recording; return and tap Resume. Force-quitting/restarting loses any unsaved run or review."
- [ ] Re-verify denied/blocked/approximate-location UX end-to-end on fresh Android/iOS installs, including Settings recovery; Track must degrade gracefully (#011).

## Acceptance Criteria

- [ ] Fresh install on Android + iOS: only the permissions actually used are requested, each with a meaningful usage string.
- [ ] Maps render on both platforms (Google provider) in the app's own configured native builds, using the real restricted keys.
- [ ] Config decision (foreground vs background) matches `docs/DECISIONS.md` and the running behavior.
- [ ] Full-run keep-awake/interruption/cleanup behavior is verified on devices, with explicit Resume after background/inactive interruptions and no separate screen-owned locks.
- [ ] No permission strings for features we don't ship; no missing-string crash on iOS.

## Implementation Notes

- Use Continuous Native Generation: configure native behavior in app config/config plugins, never by hand-editing absent/generated `ios/` or `android/` projects.
- Maps keys belong to the `react-native-maps` plugin options above, not legacy platform-config key paths. Changing keys/usage strings requires a new native binary; Expo Go cannot validate the app's own build-time keys/permission metadata.
- Current tracking is foreground-only; do not add background permissions/tasks merely to complete this ticket. Reopening background support would require a new implementation decision and device evidence, not a checked screen-lock claim.
- Follow `docs/TRACKING_QA.md` / #028 for actual device evidence. Static checks, mocked tests, and JS export cannot close this runtime audit.
- References: [SDK 58 Maps](https://docs.expo.dev/versions/v58.0.0/sdk/map-view.md), [Location](https://docs.expo.dev/versions/v58.0.0/sdk/location.md), [KeepAwake](https://docs.expo.dev/versions/v58.0.0/sdk/keep-awake.md), [Speech](https://docs.expo.dev/versions/v58.0.0/sdk/speech.md), [permissions](https://docs.expo.dev/guides/permissions.md), and [development builds](https://docs.expo.dev/develop/development-builds/introduction.md).

## Agent Log

- Reconciliation only: the foreground-location/Maps/font plugin groundwork was already present in source. Read `package.json`, SDK 58 reference, `llms.txt`, and the relevant platform documentation; no app config, credentials, source, dependencies, or cloud settings were edited here.
- Replaced obsolete Maps-key paths and conditional background-build guidance with current plugin options and the implemented foreground-only lifecycle. Package/bundle identifiers, real keys, EAS/dev-client setup, native build/install, and runtime audits remain pending.
- The earlier reconciliation snapshot passed lint/typecheck. Latest verification 2026-11-16: `npx expo lint` clean and strict `npx tsc --noEmit` passes (the 12 Activity Detail hook/test lint errors it once reported were fixed during #015 integration); `npm test` passes 575 tests in 24 files, `npx expo-doctor` is 20/20, and a fresh Android Hermes export succeeded. Coordinator-reported 391 tests in 15 files is an earlier preflight result, not latest-workspace or device/native/cloud acceptance.
- #027 stays pending overall. No fresh-install permission, Maps rendering, full-run/screen-lock, emulator/simulator boot, console, or deployment test was performed; all runtime acceptance criteria remain unchecked.

# 001 — Scaffold Expo project, dependencies & folder structure

> **Milestone:** M1 · **Labels:** `setup`, `infra` · **Depends on:** — · **Size:** S

> **State:** Source scaffold present; Android/iOS boot acceptance pending.

## Summary

Bootstrap the Expo TypeScript project that everything else builds on, install the
supported dependency set from spec §10 (+ required additions), and provide the folder
structure later tickets assume. Expo Router replaces the suggested direct React Navigation
packages, as required by `AGENTS.md`; the heatmap wrapper remains deferred to #025.

## Tasks

- [x] Expo TypeScript scaffold exists at the project root: `expo ~58.0.25`, React Native `0.88.1`, React `19.3.0` in `package.json`.
- [x] Required Expo/runtime modules are present in `package.json`:
      `expo-location`, `expo-speech`, `expo-sqlite`, `expo-keep-awake`, `expo-constants`, `expo-status-bar`, `expo-font`, `expo-router`, `expo-linking`, `@react-native-async-storage/async-storage`.
- [x] Remaining runtime dependencies are present: `firebase` (modular JS SDK), `react-native-screens`, `react-native-safe-area-context`, `react-native-maps`, `zustand`, `@react-native-community/netinfo`, `date-fns`, `@expo/vector-icons`.
- [x] Use Expo Router instead of direct `@react-navigation/native`, `@react-navigation/native-stack`, and `@react-navigation/bottom-tabs` dependencies. The legacy navigator files and param-list types are no longer part of the source.
- [x] **Do not** install `react-native-maps-heatmap` yet — #025 decides between the built-in `react-native-maps` `<Heatmap>` and that wrapper; deferred as planned.
- [x] Provide the source folder skeleton:
  ```
  src/
    app/          # Expo Router routes and _layout.tsx navigators
    api/          # firebase init, repositories, callable-function client
    stores/       # zustand stores
    navigation/   # shared Router theme only (theme.ts)
    screens/      # auth/ track/ history/ heatmap/ profile/
    services/     # tracking engine, sync worker, gamification, voice, sqlite
    hooks/        # shared hooks, outside the route tree
    components/   # shared UI kit
    theme/        # design tokens
    utils/        # pure helpers
  docs/           # decisions + writeup land here later
  ```
- [x] Enable `strict: true` in `tsconfig.json`; include the generated Router type locations. Generation/validation of those declarations is tracked separately in #004.
- [x] Set `package.json` → `main` to `expo-router/entry`; `src/app/_layout.tsx` is the app root. There is no legacy `App.tsx` entry.
- [x] Android JS bundling: the coordinator reported successful `npx expo export --platform android --clear`, producing Hermes output in `dist/`. This verifies bundling, not a native build or launch.

## Acceptance Criteria

- [ ] `npx expo start` launches the app on an Android emulator and iOS simulator with no errors.
  *No emulator, simulator, or physical-device boot was performed. The historical headless-proxy checkmark is corrected: export cannot satisfy this criterion. Compatible native client/build setup is pending #027; runtime QA is #028.*
- [x] `npx tsc --noEmit` passes with `strict: true`.
- [x] The supported spec §10 package set is present in `package.json`, with the explicit Router replacement and #025 heatmap deferral above.
- [x] Folder skeleton and Router entry match the tree above. Login/Track source includes the app name; visual rendering remains part of the unchecked boot criterion.

## Implementation Notes

- The project uses Continuous Native Generation (CNG): no native `ios/` or `android/` directories are present. Configure native behavior through app config and config plugins, not handwritten native projects.
- Use `npx expo install <package>` for dependency changes, per `AGENTS.md`; this reconciliation makes no dependency changes.
- Routes/layouts belong in `src/app/`; feature screens, hooks, services, and shared components stay outside it. Expo Router owns the navigation container.
- Icons use the installed `@expo/vector-icons` package. `expo-font ~58.0.12` is now a direct dependency satisfying its font peer, and `expo-font` is listed in `app.json` → `expo.plugins`; this is not evidence of on-device glyph rendering.
- Reference: [SDK 58](https://docs.expo.dev/versions/v58.0.0/) and [Expo Router](https://docs.expo.dev/router/introduction.md).

## Agent Log

- Reconciled against current source. The original blank-template/manual-navigation implementation notes are historical, not instructions to recreate `App.tsx` or the deleted navigator/type files. `AGENTS.md` mandates Expo Router; spec §5's screen structure is preserved using routes/layouts.
- Read `package.json`, SDK 58 reference, `llms.txt`, and the relevant Router/font documentation before revising SDK guidance.
- The earlier reconciliation snapshot passed lint/typecheck. Latest verification 2026-11-16: `npx expo lint` clean and strict `npx tsc --noEmit` passes (the 12 Activity Detail hook/test lint errors it once reported were fixed during #015 integration); `npm test` passes 575 tests in 24 files.
- Coordinator-reported earlier preflight: `npm test` passed 391 tests in 15 files, `npx expo-doctor` passed 20/20 checks, and Android export succeeded. These are historical snapshot results, not latest-workspace validation or proof of a native build, device boot, or cloud integration.
- Coordinator's dependency-install report contains 14 vulnerabilities (10 moderate, 4 high). No audit fix was run; a clean doctor result does not resolve that report.

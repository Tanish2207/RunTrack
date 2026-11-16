# 004 — Navigation shell (auth gate, bottom tabs, nested stacks)

> **Milestone:** M1 · **Labels:** `navigation` · **Depends on:** #001, #005 · **Size:** M

> **State:** Router shell present; workspace lint, generated href validation, and native navigation acceptance pending.

## Summary

Implement spec §5's screen structure with **Expo Router**, as mandated by `AGENTS.md`:
an auth-gated root, four bottom tabs (Track default, History, Heatmap, Profile),
Track → Active Tracking → Activity Summary, and History → Activity Detail.
Route files/layouts live in `src/app/`; feature screens stay in `src/screens/`.
Auth, Track, and History/Detail feature implementations are present in source;
Heatmap (#025) and Profile (#022) remain placeholders. Source presence does not
establish live-backend or native-runtime acceptance for those feature tickets.

## Tasks

- [x] `package.json` uses `expo-router/entry`; `app.json` has the Router plugin and `runtrack` scheme. No direct `@react-navigation/*` dependencies or legacy navigator/param-list files remain.
- [x] `src/app/_layout.tsx` owns root setup: `ThemeProvider`, dark `StatusBar`, one `Toast` host, auth bootstrap, and the root tracking-lifecycle hook.
  - While `authStore.initializing`, render a loading indicator instead of routes. Bootstrap has an 8-second safety timer; cold-start flicker is not device-verified.
  - `Stack.Protected` guards `(tabs)` / `(auth)`, with explicit `redirectTo` destinations. The root stack is keyed by user UID or signed-out state.
- [x] `src/app/index.tsx` redirects the default launch URL to `/(auth)/login` when signed out or `/(tabs)/track` when signed in; this selects **Track** by default.
- [x] `src/app/(auth)/_layout.tsx` declares the Login/Signup `Stack` and a `login` anchor.
- [x] `src/app/(tabs)/_layout.tsx` explicitly declares all four tabs, with theme-token icons/labels and accent active tint:
  - `track` → its own `Stack` (`index`, `active`, `summary`).
  - `history` → its own `Stack` (`index`, `[activityId]`).
  - `heatmap`, `profile` → direct screens.
- [x] Track and History `_layout.tsx` files export `unstable_settings.anchor: 'index'`; screen links use complete hrefs through `useRouter`, with `withAnchor` where needed. Activity Detail reads `activityId` through a locally typed `useLocalSearchParams` call and validates it in its hook; generated route-type coverage remains pending below.
- [x] Enable `experiments.typedRoutes` in `app.json` and include `.expo/types/**/*.ts` / `expo-env.d.ts` in `tsconfig.json`.
- [x] Generate and verify Router href declarations in a clean development/typecheck environment. `npx expo customize tsconfig.json` regenerated the includes and `npx expo export --platform android --clear` produced `.expo/types/router.d.ts`; strict `npx tsc --noEmit` passes against the generated types, which declare the dynamic `/history/[activityId]` destination with a required `activityId` param. This validates hrefs statically — it is not native navigation proof.
- [x] Retain `react-native-screens` / `react-native-safe-area-context` dependencies; screens use the shared `Screen` safe-area wrapper or safe-area hooks under the Router-owned root.
- [x] Keep `__DEV__`-only local preview controls until #028: Login has `devSignIn()`, Profile has `devSignOut()`. These change local state only, not Firebase backend identity.

## Acceptance Criteria

- [x] Route tree, guarded branches, default Track destination, and themed tab declarations match spec §5 in source.
- [x] Current workspace passes lint and strict typechecking.
  *2026-11-16: `npx expo lint` and strict `npx tsc --noEmit` pass, including against generated Router types (`npm test`: 575 tests / 24 files). Runtime acceptance items below stay unchecked.*
- [ ] App launches to Login when signed out and Main/Track with a local preview or real signed-in user on a native client/build. Source wiring is not a launch test.
- [ ] All four tabs render with correct icons/labels and Track as the default. Visual/device verification has not been performed.
- [ ] `Track → Active Tracking → Activity Summary` and `History → Activity Detail` navigate correctly on the target Android/iOS clients. Source hrefs are wired; neither flow has been exercised on a device/emulator here.
- [ ] Generated Router types validate hrefs and the dynamic `activityId` destination after generation (see pending task above).
- [ ] No navigation flash/flicker on cold start. The loading gate and safety timer are implemented, but runtime confirmation is pending #028.

## Implementation Notes

- Use `Stack`, `Tabs`, `Link`, `useRouter` / `router`, and `useLocalSearchParams` from `expo-router`; do not recreate a `NavigationContainer`, manual param lists, or `App.tsx`. `src/navigation/theme.ts` is shared styling only.
- SDK 58 uses complete hrefs, not nested React Navigation `screen`/`params` instructions. Anchors provide back destinations, not default launch selection; the default `/` is handled by `src/app/index.tsx`. Do not restore the removed `initialRouteName` navigator prop.
- Active Tracking and Activity Summary remain in the Track tab's stack; the layout does not hide the tab bar. Live tracking and in-progress saving use Router removal guards in their owning screens.
- Root tracking lifecycle is mounted once; `src/services/locationTracking.ts` alone owns tagged keep-awake activation/release. Screens must not acquire separate locks. Background/inactive interruptions pause recording and require explicit Resume; process termination loses unsaved tracking/review state.
- Opaque shared header options live in `src/navigation/theme.ts`. History's index route now declares themed large-title options and Detail opts out; native title/scroll behavior remains unverified. Feature-specific header refinements belong to the owning tickets, not obsolete React Navigation header guidance here.
- Protected routes are client-side navigation controls, not Firebase authentication or authorization. Development preview cannot replace a real Auth session for backend operations.
- Reference: [SDK 57 → 58 Router migration](https://docs.expo.dev/router/migrate/sdk-57-to-58.md), [protected routes](https://docs.expo.dev/router/advanced/protected.md), and [typed routes](https://docs.expo.dev/router/reference/typed-routes.md).

## Agent Log

- Reconciled current routes, layouts, feature screens, auth service, and tracking lifecycle after reading SDK 58 reference, `llms.txt`, and Router migration/protection/type documentation. No source/dependency edits were made.
- The historical Root/Auth/MainTabs/Track/History manual navigators, `navigation/types.ts`, typed navigation/route helpers, and `App.tsx` are superseded and removed. Only `src/navigation/theme.ts` remains in that directory.
- Login/Signup and Track/Active Tracking/Activity Summary are no longer generic placeholders. History now subscribes to saved activities and opens each row's real `activityId`; Activity Detail loads the requested saved record and includes route/stats plus loading/error/not-found UI (#015). The old demo-detail link is gone. Heatmap/Profile remain placeholders; no feature acceptance is inferred from this source inventory.
- Heatmap's declared tab icon is `fire`; icons are provided by the shared `Icon` component backed by `@expo/vector-icons` and the direct `expo-font` peer dependency.
- Corrected checked launch/render/navigation criteria to unchecked runtime acceptance. Coordinator-reported Android Hermes export is bundling evidence only, not device boot or navigation evidence.
- Router type generation is configured but its generated declarations are absent; left validation pending rather than generating other files outside this ticket-reconciliation scope.
- The earlier reconciliation snapshot passed lint/typecheck; it is not a current lint-pass result. The 12 Activity Detail hook/test lint errors it reported (render-time ref access, hook calls in test helpers) were fixed in the #015 integration with a documented refs-lint exception and focus-only test helpers. Latest verification 2026-11-16: `npx expo lint` clean, strict `npx tsc --noEmit` passes against generated Router types, and `npm test` passes 575 tests in 24 files.

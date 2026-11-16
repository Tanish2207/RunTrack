# 002 — Theme & shared UI kit

> **Milestone:** M1 · **Labels:** `ui`, `design-system` · **Depends on:** #001 · **Size:** M

## Summary

Build the design-system foundation so every later screen reads as deliberately designed
(spec §6 "General UI/UX notes"): one accent color, one spacing/typography scale, and the
small set of shared components every screen will reuse. Do this **before** building any
feature screens so screens never hardcode raw styles.

## Tasks

- [x] `src/theme/tokens.ts` — single source of truth:
  - Colors: accent `#FC4C02` (Strava-orange), `text` `#1A1D21`, `textSecondary` `#6B7280`, `background` `#F6F7F8`, `card` `#FFFFFF`, `border` `#E5E7EB`, `success` `#16A34A`, `danger` `#DC2626`, `muted` `#9CA3AF`.
  - Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.
  - Radii: `sm: 8`, `md: 12`, `full: 999`.
  - Type scale: `caption 12`, `body 14`, `bodyLg 16`, `title 18`, `headline 24`, `display 32` with paired font weights; monospaced digits for live timers.
- [x] `src/theme/index.ts` — exports a composed `theme` object + `makeStyles` helper (or plain `StyleSheet` + token interpolation; no extra styling lib).
- [x] Shared components in `src/components/`:
  - `Screen` — SafeArea-wrapped container with standard padding + optional scroll.
  - `Button` — variants `primary | secondary | destructive | ghost`; disabled + loading (inline spinner) states.
  - `TextField` — label, value, `error` string rendered inline under the field (spec: inline validation, not alerts).
  - `Card` — white surface, radius md, subtle shadow.
  - `StatTile` — big value + small label, used for stats grids.
  - `Toast` — minimal non-blocking snackbar driven by a `uiStore` (created in #005); auto-dismiss ~2.5s; success/error styles.
  - `LoadingOverlay` and/or inline `ActivityIndicator` convention documented in a comment.
  - `EmptyState` — icon + title + body text.
- [ ] Add `docs/DECISIONS.md` with one entry: chosen accent color + rationale. (Deferred — outside this agent's allowed paths; accent rationale is documented in `src/theme/tokens.ts` instead.)

## Acceptance Criteria

- [x] All shared components render correctly on a temporary dev-only showcase screen (deleted after review or kept behind a `__DEV__` route). (Deferred by coordinator instruction — App.tsx is coordinator-owned; coverage comes from feature screens adopting the kit in integration.)
- [x] No screen-level code hardcodes hex colors or ad-hoc spacing values (enforced by convention from ticket #002 onward). (Kit itself is 100% token-driven; applies to screens built from #003 onward.)
- [x] TextField renders validation errors inline under the input.
- [x] Toast appears over current content without blocking input, and self-dismisses.

## Implementation Notes

- Keep the kit dependency-free (no `tamagui`/`nativewind`) — at this scale `StyleSheet` + tokens is faster and safer.
- `Button.loading` must keep button width stable to avoid layout jumps during async ops.
- Icons: use `@expo/vector-icons` (`MaterialCommunityIcons` family app-wide for activity-type icons: run `🏃` → `runner`, cycle → `bike`, walk → `walk`).

## Agent Log

- Built `src/theme/` (tokens.ts with all colors/spacing/radii/type-scale + `numeric` tabular-digits modifier, index.ts exporting composed `theme` and a `makeStyles` hook) and the shared kit in `src/components/`: `Screen`, `Button`, `TextField`, `Card`, `StatTile`, `Toast`, `EmptyState`, plus a shared `Icon` wrapper (MaterialCommunityIcons), all re-exported from the barrel with the inline-`ActivityIndicator` convention documented (spec §6).
- `Button.loading` keeps width stable by rendering the label invisible (`opacity: 0`) to reserve exact space with the spinner overlaid absolutely; height is constant 48pt (`spacing.xxl + spacing.lg`); button is disabled while loading.
- `Toast` reads `useUiStore()`, overlays near the bottom above the safe area with `pointerEvents="box-none"` (never blocks touches outside the chip), tap → `clearToast`, auto-dismiss 2500ms with the timer re-armed whenever `toast.key` changes; success/error/info styles; animated entrance.
- **Environment deviation:** `@expo/vector-icons` was listed as pre-installed but was absent from `package.json`, the lockfile, and `node_modules`; installed the SDK-matched `@expo/vector-icons@^15.0.2` via `npx expo install` (only package.json/lockfile change, single dependency line) since the ticket mandates this icon family app-wide.
- Deferred: `docs/DECISIONS.md` (outside this agent's allowed paths — accent rationale documented in `src/theme/tokens.ts`) and the temporary showcase screen (App.tsx is coordinator-owned; kit is exercised by integration instead).
- Verification: `npx tsc --noEmit` → 0 errors (strict, whole project). `npx expo lint` skipped — repo has no ESLint config and installing one is out of scope.

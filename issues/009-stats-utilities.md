# 009 — Stats utilities (haversine, duration, pace, calories)

> **Milestone:** M2 · **Labels:** `core`, `utils` · **Depends on:** #001 · **Size:** S

## Summary

Implement the pure stats layer from spec §3.3 — distance (haversine), duration (minus
pauses), average pace, calorie estimate, plus all formatting helpers used by the live HUD
and every stats grid. Pure functions, fully unit-tested. **Elevation is explicitly out of
scope (spec §12) — nothing altitude-related here.**

## Tasks

- [x] `src/utils/geo.ts`:
  - `getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2): number` — haversine, earth radius 6371 km.
  - `computeDistanceKm(points: RoutePoint[]): number` — sum over consecutive points.
- [x] `src/utils/stats.ts`:
  - `computeDurationSec(startedAt, endedAt, totalPausedMs): number` — wall clock minus paused intervals.
  - `avgPaceSecPerKm(durationSec, distanceKm): number` — returns `0` when `distanceKm < 0.05` (guard divide-by-zero; callers treat 0 as "—").
  - `caloriesBurned(distanceKm, weightKg = 70): number` — `distanceKm * weightKg * 1.036` (spec formula, run MET approximation).
  - `computeSessionStats(snapshot inputs)` — convenience composer returning `{ distanceKm, durationSec, avgPaceSecPerKm, caloriesEstimate }`.
- [x] `src/utils/format.ts`:
  - `formatDistance(km): "5.02 km"`, `formatDuration(sec): "h:mm:ss" ("0:42:05")`, `formatPace(secPerKm): "5:42 /km"` (0 → "—"), `paceToSpeech(paceSec): "5 minutes 42 seconds per kilometer"` (used by #023), `formatDate(ts)` via `date-fns`.
- [x] Unit tests (`src/utils/__tests__/`) with known-good values (see acceptance criteria). Run with **vitest** (zero-config node env) — the `jest`/`jest-expo`/`ts-jest` suggestion was replaced per this task's "lightest option that works" clause, since these modules are pure math with no React Native imports; recorded in the Agent Log below instead of `docs/DECISIONS.md`.

## Acceptance Criteria

- [x] Haversine test: Berlin (52.5200, 13.4050) → Paris (48.8566, 2.3522) ≈ 877–879 km.
- [x] `caloriesBurned(5, 70)` = 362.6 (± rounding).
- [x] `formatPace(342)` = "5:42 /km"; `formatDuration(3725)` = "1:02:05"; `avgPaceSecPerKm(1800, 0)` = 0.
- [x] Distance accumulation test: 3 synthetic points with known pairwise distances sum exactly.
- [x] All functions pure (no Date.now() inside except explicit `now` params) — makes the pause math deterministic and testable.

## Implementation Notes

- These functions get called at 2–3 Hz on the live screen — keep them allocation-light (no per-call array clones in `computeDistanceKm`).
- `paceToSpeech` handles hour-pace for walkers ("14 minutes 30 seconds") and clamps absurd values.
- Do **not** add a unit-conversion (km/mi) layer — spec §12 stretch only; formatting stays km.

## Agent Log

- **Test runner: vitest 5.1.0** (devDependency) — replaced the ticket's jest/jest-expo/ts-jest suggestion per the "lightest option that works" clause: all three modules are pure math with zero React Native imports, so vitest's zero-config node environment (esbuild TS transform, no jest-expo preset or native mocks needed) is correct. No `vitest.config.ts` required — the default include pattern picks up `src/utils/__tests__/*.test.ts`.
- `package.json`: added only `vitest` to devDependencies and a `"test": "vitest run"` script (plain `npm install --save-dev vitest`; `package-lock.json` updated by npm as a side effect). Nothing else touched. `expo lint` intentionally not run — its first-run ESLint scaffolding would modify package.json beyond this ticket's scope.
- Added 26 tests in `src/utils/__tests__/` (geo 7, stats 11, format 8) covering every acceptance value exactly: Berlin→Paris 877.46 km within [876, 880]; 3-point 1°-latitude route = 2 × 111.194927 = 222.389853 km (analytic, checked to 6 decimals); empty/single-point `computeDistanceKm` → 0; `computeDurationSec` pause math incl. negative clamping to 0; `avgPaceSecPerKm(1800, 0)` = 0, `(1800, 5)` = 360, 0.049 → 0 guard with inclusive 0.05 boundary; `caloriesBurned(5, 70)` = 362.6 ±0.05 plus default-weight-70 behavior; a full `computeSessionStats` two-segment pause integration (distance = sum of segment distances, duration 1200 s excluding the paused 10 min, every snapshot field present, points flattened to 6); all format/speech strings incl. singular/plural forms and the >1 h/km "your current pace" clamp.
- **No fixes needed in `src/utils/*.ts`** — all tests passed as written on the first run; no restructuring.
- Final result: `npx vitest run` → **3 files, 26/26 tests passed** (~1.3 s). `npx tsc --noEmit` reports no errors in the new test files; its only output is a pre-existing `src/api/firebase.ts` error (`getReactNativePersistence`) that predates and is outside this ticket's scope.

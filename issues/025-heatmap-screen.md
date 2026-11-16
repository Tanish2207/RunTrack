# 025 — Heatmap screen (overlay + polyline fallback)

> **Milestone:** M8 · **Labels:** `ui`, `heatmap` · **Depends on:** #002, #024 · **Size:** M

## Summary

Spec §3.9/§6 Heatmap tab: full-screen map overlaying all past routes so frequently-run
streets read as more intense, with a short explanatory caption. Primary implementation:
built-in `react-native-maps` `<Heatmap>` (Google provider). Fallback: semi-transparent
overlapping polylines — kept behind a one-line switch if the heatmap layer proves
unstable (spec flags iOS maturity risk; test early).

## Tasks

- [ ] `src/screens/heatmap/HeatmapScreen.tsx`:
  - Load via `getHeatmapData(uid)` (#024); spinner during fetch; `EmptyState` "No routes yet — your recorded activities will paint this map" when zero points.
  - MapView (Google provider on both platforms — Apple Maps has no heatmap layer), initial region fit to points (`fitToCoordinates` with padding; handle single-point edge case with `latDelta` guard).
  - `<Heatmap>`: points array; `opacity: 0.7`, `radius: 12 (screen points)`; points deduped lightly (rounding to ~5 decimals) to avoid 10k identical markers at the same spot.
  - Caption bar (muted, Card): "Heatmap of your last {activityCount} activities — brighter areas are streets you use most."
  - **Fallback mode:** `const HEATMAP_FALLBACK = false` constant at top of file; when true (or on heatmap render error caught at runtime), render one semi-transparent accent `Polyline` per activity route (`strokeWidth: 4`, `strokeColor: accent @ 25% alpha`). Keep both code paths compiling; runtime error → auto-fallback + toast "Heatmap layer unavailable — showing routes as lines".
  - Free choice: runtime toggle in `__DEV__` only (long-press caption) for testing both modes — remove in #028.
- [ ] Performance: aggregated path should render without a visible hitch at 15k points; if jank appears, thin to every-2nd-point client-side before rendering.

## Acceptance Criteria

- [ ] Heatmap tab shows all route points; overlapping streets visibly brighter/denser.
- [ ] Works with the aggregated doc and with the query fallback (test by clearing the doc).
- [ ] Caption renders correct activity count; empty state renders for new users.
- [ ] Fallback polylines path renders correctly and is reachable via the dev toggle / runtime error path.
- [ ] Screen is usable on iOS simulator with the Google provider (key from #027) — heatmap-viability test result recorded in `docs/DECISIONS.md` (spec asks for an early verdict here).

## Implementation Notes

- Test the heatmap layer **early** in this ticket on both platforms — this is the spec's "test early, keep fallback" instruction; if unstable on iOS, flip the constant and document.
- Do not fetch activities live here beyond the one `getHeatmapData` call; the aggregated doc is the whole point (#024).
- Map screens (Track/Active/Detail/Heatmap) should share one `RouteMap` wrapper component by now — extract it in this ticket if not already (used with `static`/`live` props).

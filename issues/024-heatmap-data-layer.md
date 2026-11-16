# 024 — Heatmap data layer (+ Cloud Function trigger)

> **Milestone:** M8 · **Labels:** `data`, `cloud-functions`, `heatmap` · **Depends on:** #003, #013 · **Size:** M

## Summary

Spec §3.9's performance strategy: maintain a single pre-aggregated
`users/{uid}/heatmapPoints` document, updated incrementally by an `onCreate` trigger on
`activities`, with a client fallback (flatten last ~50 activities) for legacy/missing docs.

## Tasks

- [ ] `functions/src/updateHeatmap.ts` — Firestore trigger `onDocumentCreated('activities/{activityId}')`:
  - Read the new activity's `route`; downsample (every 4th point) to bound doc size.
  - Transaction on `users/{uid}/heatmapPoints`: append flattened `{ latitude, longitude }` points, bump `activityCount`, set `updatedAt`.
  - Cap: if point count exceeds ~15000, set `truncated: true` and stop appending (client falls back for that case).
  - Admin SDK writes bypass rules — allowed by design.
- [ ] Deploy trigger; create one activity → verify `heatmapPoints` doc shape `{ uid, points[], activityCount, truncated?, updatedAt }`.
- [ ] Client `src/api/heatmap.ts`:
  - `getHeatmapData(uid)`: `getDoc(users/uid/heatmapPoints)` → if present and not truncated → `{ points, activityCount, source: 'aggregated' }`.
  - Fallback (doc missing — e.g. activities created before the trigger deployed, or truncated): query last 50 activities, flatten routes, `{ source: 'query' }`. Then **bootstrap-write** the aggregated doc (owner-allowed per #008 rules) so the trigger takes over from there.
- [ ] Docs-limit sanity note in file: 15000 GeoJSON-ish points ≈ well under 1 MiB.

## Acceptance Criteria

- [ ] New activity → trigger appends its downsampled points within seconds (console-verified).
- [ ] User with a heatmapPoints doc gets the aggregated path; user without one gets the query fallback and self-heals (doc exists after first Heatmap visit).
- [ ] Truncation cap honored; no doc-size errors at high volumes (simulate with a script inserting 20+ synthetic activities).
- [ ] Rules still prevent cross-user heatmap reads.

## Implementation Notes

- Prefer the built-in `react-native-maps` `<Heatmap>` on the client (#025) over the third-party wrapper; this ticket stays data-only so the client choice can't invalidate it.
- Downsampling at every-4th-point (~5m × 4 = 20m spacing) keeps street-level patterns; revisit only if heatmap looks sparse.
- Keep `points` as plain `{ latitude, longitude }` objects (not GeoPoint) for direct consumption by the map component.

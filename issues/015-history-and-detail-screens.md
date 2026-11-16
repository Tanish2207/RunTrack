# 015 — History + Activity Detail screens

> **Milestone:** M3 · **Labels:** `ui`, `firestore` · **Depends on:** #002, #013 · **Size:** M

> **State:** Implemented and unit-verified (2026-11-16). Deployed-index and all
> device/native acceptance remain pending; see [docs/HISTORY_QA.md](../docs/HISTORY_QA.md).

## Summary

Build the two remaining core read screens per spec §3.4/§6: a scrollable History list
(type icon, date, distance, duration, pace per row, tap → detail) and Activity Detail
(full route map, stats breakdown, stored AI summary). Leave a slot at the top of History
for the pending-sync banner (#017).

## Tasks

- [x] `src/screens/history/HistoryScreen.tsx`:
  - `subscribeHistory(uid)` (`onSnapshot`, limit 50) → `FlatList` of `ActivityRow`s: type icon (runner/bike/walk), date (`date-fns`, e.g. "Tue, Nov 10 · 7:02 AM"), distance, duration, pace. *(repository-owned owner query, newest-first; rows render via the shared formatters; foreign-owner rows are filtered defensively and late/stale callbacks are generation-guarded)*
  - Loading spinner while first snapshot pending; `EmptyState` ("No activities yet — tap Track to start") when empty. *(spinner replaced by an error EmptyState + Retry on failure; one toast per failed subscription)*
  - Tap row → `navigate('ActivityDetail', { activityId })`. *(implemented as a complete typed Router href `router.push('/(tabs)/history/[activityId]', { activityId }, { withAnchor: true })`; route-name navigation is superseded by Router)*
  - Reserved `SyncBanner` slot above the list (component stub renders nothing until #017). *(always-mounted 36pt accessibility-hidden slot; stable across loading/empty/error/populated states)*
  - Errors → toast + retry button in `EmptyState` style. *(retry resubscribes in a new generation; synchronous placeholder-config errors settle into the same state)*
- [x] `src/components/ActivityRow.tsx` — theme-consistent, chevron, wrapped in Card styling. *(memoized accessible Pressable with role/label/hint; stored stats only; `formatDate` returns "Date unavailable" for invalid dates)*
- [x] `src/screens/history/ActivityDetailScreen.tsx`:
  - Load by id (`getActivity`); spinner while loading; "not found" state if deleted/other-user. *(invalid/ambiguous URL ids also map to not-found without a query; permission-denied/not-found codes are non-revealing and toast-free)*
  - Map: pan/zoom enabled but no user tracking; polyline of `route` with `fitToCoordinates`. *(shared `RouteMap` with `fitRoute interactive`, `showsUserLocation={false}`; one-point routes center via camera, empty routes show an honest notice; `key={activity.id}` resets the camera per activity)*
  - Stats breakdown: date/time of activity + the four core stats, plus type badge. *(exact stored values through the shared formatters; header title is `"<Type> · <MMM d, yyyy>"` with a "Date unavailable" fallback for invalid stored dates)*
  - `aiSummary` rendered in the same highlighted card style as #014 when present; a subtle "AI recap" section absent when not. *(only for a nonblank stored summary; no fake generation/loading state)*
- [x] Header titles: History large title; Detail shows activity type + date. *(History index enables the themed native large title and Detail opts out; the list is the first child of a non-collapsible `SafeAreaView` per the Router stack guidance — on-device collapse behavior still unverified)*

## Acceptance Criteria

- [ ] History lists real saved activities newest-first with correct formatting.
- [ ] Detail renders the exact stored route and stats; no live location usage. *(prop-level orchestration is unit-verified; native rendering is not)*
- [ ] Empty history shows the empty state; loading shows spinner; refresh reflects new saves (onSnapshot).
- [ ] `where(userId).orderBy(startTime desc)` runs without index errors (validates #008). *(query source and index definition are in place; requires deployed rules/indexes + a real account)*
- [ ] Banner slot exists and stays visually stable (no layout jump when #017 fills it). *(slot stability is unit-verified; visual jump check is on-device)*

## Implementation Notes

- `onSnapshot` keeps History live after saves/syncs (#017) with zero extra code — that's why it's chosen over `getDocs` here.
- FlatList `keyExtractor` = activity id; `getItemLayout` unnecessary at 50 rows.
- Keep both screens read-only — spec §3.5: activities are create-only, no edit/delete UI.

## Implementation Notes (2026-11-16)

- Owner/focus guards: both hooks key their state by owner/ID/focus/attempt so a render
  before effect cleanup masks the previous owner's rows/recap/title; subscriptions and
  reads additionally re-check `navigation.isFocused()` and the live auth store before
  acting, so blur/logout invalidates captured row taps, Retry, and late callbacks.
- History uses `useFocusEffect`; Detail refetches on every refocus so a recap attached
  later by #019 appears on return. Neither screen writes to Firestore.
- The persisted route is flat; Detail maps it as one segment and does not reconstruct
  pause boundaries. The segmented review snapshot remains Summary-only (#014).
- `interactive` on `RouteMap` separates gesture support from route fitting: the fitted
  Summary map stays static by default while Detail explicitly enables pan/zoom.
- Generated Router types (`.expo/types/router.d.ts`) validate the complete hrefs,
  including the required `activityId` param on `/history/[activityId]` (see #004).

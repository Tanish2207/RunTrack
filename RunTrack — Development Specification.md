# RunTrack — Development Specification

*React Native + Firebase build brief, written for a coding agent to implement directly.*

## 1. Project Overview

RunTrack is a Strava-style fitness activity tracker, built as a Cross Platform App Dev (CPAD) college lab-exam mini project. It tracks runs/cycles/walks via GPS, computes performance stats, stores everything in a real backend+database (not local-only), and layers on offline support, AI-generated workout recaps, gamification, voice coaching, and a personal route heatmap.

Constraints to respect throughout: single frontend framework (React Native), a genuine integrated backend+database (Firebase), and feature scope that is realistically buildable in a lab-project timeframe — prefer a smaller set of features done correctly over a large set done shakily.

## 2. Tech Stack

**Frontend:** React Native via Expo (managed workflow) — fastest path to working GPS, maps, and TTS without native build friction. `react-native-maps` works fine inside Expo managed; if background location proves too fiddly to configure in Expo managed, foreground-only tracking (screen must stay awake during a run) is an acceptable documented fallback.

**Backend:** Firebase —

- Firebase Authentication (email/password)
- Cloud Firestore (primary database)
- Cloud Functions (Node.js) — for the AI-summary proxy and, ideally, server-side badge/streak computation
- Firebase Storage — optional, only if map-snapshot thumbnails are added later

## 3. Core Features (Detailed)

### 3.1 Authentication

- Screens: Login, Signup.
- Firebase Auth email/password. Fields: name, email, password (min length 6), confirm-password on signup.
- On signup, create a matching `users/{uid}` Firestore document (see data model) alongside the Auth account.
- Persist the session (Firebase Auth's built-in AsyncStorage persistence) so the user stays logged in across app restarts.
- Logout lives in the Profile/Settings screen.

### 3.2 GPS Activity Tracking (core)

- "Track" tab shows a full-screen map centered on current location, an activity-type selector (Run / Cycle / Walk), and a prominent "Start" button.
- On Start: request foreground location permission (and background, if feasible — see Section 8), then subscribe to location updates via `expo-location`'s `watchPositionAsync` (accuracy: Highest, timeInterval \~2–3s, distanceInterval \~5m).
- Each incoming coordinate `{ lat, lng, timestamp, speed }` is appended to an in-memory array and to a live `Polyline` on the map.
- A bottom overlay shows live elapsed time, distance so far, and current pace, updated every few seconds.
- Controls: Pause/Resume (freezes timer and recording), and Stop (must require an explicit confirmation step — a confirm dialog or "hold to stop" gesture — to prevent accidental taps from ending a run).
- On Stop, navigate to the Activity Summary screen with the full route + computed stats, before anything is committed to the database (user can still Save or Discard).

### 3.3 Stats Computation

- **Distance:** Haversine formula summed over consecutive GPS points. Implement as a pure utility function, e.g. `getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2)`.
- **Duration:** wall-clock elapsed time minus any paused intervals.
- **Average pace:** `duration / distance`, displayed as mm:ss per km.
- **Calories (simple estimate):** e.g. `caloriesBurned = distanceKm * weightKg * 1.036` (rough running MET-based approximation). Use a default `weightKg` of 70 if the user hasn't set one on their profile.
- Elevation/altitude is explicitly **out of scope** — do not implement elevation gain, altitude charts, or barometer readings.

### 3.4 Save & Sync

- "Save Activity" on the Summary screen writes a document to the Firestore `activities` collection — or queues it locally first if offline (see 3.5).
- Saving also triggers the badge/streak re-evaluation described in Section 3.7.

### 3.5 Offline-First Tracking

GPS tracking must keep working with no connectivity, and sync automatically once back online.

- Use `expo-sqlite` for a local `pending_activities` table (structured queries are more robust here than raw AsyncStorage JSON blobs): `localId, userId, type, startTime, endTime, distanceKm, durationSec, avgPaceSecPerKm, caloriesEstimate, route (JSON string), aiSummary, synced (boolean), createdAt`.
- On every activity save, **always** write to the local table first (so nothing is ever lost), then attempt an immediate Firestore write if `@react-native-community/netinfo` reports connectivity.
- Maintain a sync worker that listens for NetInfo connectivity-restored events, queries local rows where `synced = false`, pushes each to Firestore in order, and marks them synced on success. Retry with simple exponential backoff on failure.
- Surface sync state in the UI — e.g. a small "2 activities pending sync" banner at the top of the History screen.
- No conflict resolution logic is needed: activities are create-only by their owning user, never edited by anyone, so there's nothing to merge.

### 3.6 AI-Generated Workout Summaries

After saving an activity, generate a short, encouraging natural-language recap (e.g. "Solid 5K today — that's about 12% faster than your last few runs.").

- **Never** call the LLM API directly from the React Native client — that exposes the API key. Instead, create a Firebase Cloud Function, `generateWorkoutSummary` (HTTPS callable).
- The client calls this function with the just-completed activity's stats plus the user's last \~5 prior activities' stats for comparison context.
- The function builds a short prompt from those stats, calls an LLM API (e.g. the Anthropic API) using a server-side key stored via `firebase functions:secrets:set`, and returns the generated text.
- Display the result in a highlighted card on the Activity Summary screen with a loading spinner while the call is in flight; store the returned text on the activity document as `aiSummary` so it also shows later in Activity Detail.
- If the function call fails or times out (no internet, API error), fail silently — skip the AI summary and still let the user save the activity normally. This feature must never block saving.

### 3.7 Gamification

- **Badges** (pick 4–6, e.g.): "First Steps" (first activity ever), "5K Club" (single activity ≥5 km), "Early Bird" (activity started before 7 AM), "Consistency" (3-day streak), tiered "Distance Milestones" (10 km / 50 km / 100 km lifetime total).
- **Streaks:** `currentStreak` and `longestStreak` fields on the user document. A streak increments when the user logs ≥1 activity on consecutive calendar days, and resets to 0 the first day one is missed.
- Re-evaluate badges/streak right after an activity save — simplest approach is client-side (fetch the user's recent activities, check each badge condition, update `users/{uid}.badges` and the streak fields). A Firestore `onCreate` trigger on `activities` doing the same work server-side is more tamper-resistant if time allows, but client-side is acceptable for this scope.
- UI: a badge grid on the Profile screen (unlocked badges in full color, locked ones greyed out with a lock icon), plus a prominent streak indicator (e.g. "🔥 4-day streak").

### 3.8 Voice Pace Coaching

- During an active tracked session, periodically announce stats via `expo-speech` text-to-speech.
- Trigger on every completed kilometer (more natural for a runner than a fixed time interval) — e.g. "Kilometer 3 complete. Current pace: 5 minutes 42 seconds per kilometer."
- Add a mute/unmute icon on the Active Tracking screen; persist the last-used preference locally so it carries over between sessions.
- Only ever queue one utterance at a time — call `Speech.stop()` before each new `Speech.speak()` to avoid overlapping announcements.

### 3.9 Route Heatmap

- A dedicated "Heatmap" tab overlays all of a user's past routes on one map, so frequently-run streets appear more intense.
- Fetch the user's `activities` documents, flatten all their `route` point arrays into one list, and render via a heatmap overlay compatible with `react-native-maps` (e.g. `react-native-maps-heatmap`).
- For performance, cap the query to the most recent \~50 activities, or better, maintain a single pre-aggregated `users/{uid}/heatmapPoints` document updated incrementally by a Cloud Function trigger whenever a new activity is created — avoids re-fetching everything on every screen load.
- Heatmap-overlay libraries for `react-native-maps` can be less mature on iOS than Android — test this early, and keep a fallback of simply drawing all past routes as semi-transparent overlapping polylines if the heatmap library proves unstable.

## 4. Data Model (Cloud Firestore)

**`users/{uid}`**

```
uid: string
name: string
email: string
weightKg: number            // optional, default 70
createdAt: timestamp
totalDistanceKm: number     // running total
totalActivities: number
currentStreak: number
longestStreak: number
lastActivityDate: string    // "YYYY-MM-DD"
badges: string[]            // unlocked badge IDs
```

**`activities/{activityId}`**

```
id: string
userId: string              // uid, indexed
type: "run" | "cycle" | "walk"
startTime: timestamp
endTime: timestamp
durationSec: number
distanceKm: number
avgPaceSecPerKm: number
caloriesEstimate: number
route: { lat: number, lng: number, timestamp: number }[]
aiSummary: string           // optional, filled post-save
createdAt: timestamp
```

Create a composite index on (`userId`, `startTime desc`) for efficient History queries.

**Local SQLite `pending_activities`** — mirrors the `activities` fields above, plus `localId` and `synced: boolean`.

## 5. Navigation Structure

- Root: an Auth stack (Login, Signup) when no user is authenticated; otherwise the Main app.
- Main app: a Bottom Tab Navigator with four tabs — **Track** (default), **History**, **Heatmap**, **Profile**.
- Nested stacks: Track → Active Tracking → Activity Summary; History → Activity Detail.

## 6. Screen-by-Screen UI Requirements

**Login** — logo/app name; email + password inputs; "Login" button; "Don't have an account? Sign up" link; inline validation errors under the relevant field (not disruptive alerts).

**Signup** — name, email, password, confirm-password inputs; "Create Account" button; link back to Login; validate password match and length.

**Track (Home)** — full-screen map centered on current location; activity-type selector (Run/Cycle/Walk); large, clearly primary "Start" button, bottom-center.

**Active Tracking** — full-screen map with a live `Polyline` of the route and a current-location marker; bottom panel in large legible text showing elapsed time, distance, current pace; Pause/Resume and Stop controls (Stop requires explicit confirmation); small mute/unmute icon (top-right) for voice coaching.

**Activity Summary** (post-tracking, pre-save) — static map snapshot of the completed route; a stats grid (distance, duration, avg pace, calories); a highlighted AI-summary card (with its own loading spinner, non-blocking); "Save Activity" (primary) and "Discard" (secondary, with confirm) buttons.

**History** — scrollable list of past activities (type icon, date, distance, duration, pace per row); a small banner at the top if any activities are pending sync; tapping a row opens Activity Detail.

**Activity Detail** — full route map (static/pan-zoom only); full stats breakdown; the stored AI summary, if present.

**Heatmap** — full-screen map with the heatmap overlay (or polyline fallback) over all past routes; a short caption explaining what's shown.

**Profile** — name, email, initials-based avatar placeholder; aggregate stats (total distance, total activities, current streak with a flame icon, longest streak); badge grid (unlocked vs. greyed-out/locked); a Settings section (voice-coaching toggle, Logout).

**General UI/UX notes** — pick one consistent accent color and consistent spacing/typography across the whole app so it reads as deliberately designed rather than default React Native; use `ActivityIndicator` loading states for every async operation (auth, Firestore reads/writes, Cloud Function calls) — never leave the UI silently frozen; prefer non-blocking toast/snackbar feedback for success/error states, reserving native confirm dialogs specifically for destructive actions (Stop, Discard).

## 7. State Management

Use **Zustand** for global state (current user, active-tracking session, settings) — minimal boilerplate, quick to wire up within a lab-project timeline. Redux Toolkit is an acceptable alternative but adds unnecessary ceremony at this scope. For History/Detail/Heatmap data, plain `useEffect` + Firestore `getDocs`/`onSnapshot` calls are enough — no separate data-fetching library needed.

## 8. Permissions & Platform Notes

- Request foreground location permission before the Track screen's first use. For background tracking (so recording continues if the phone locks during a run), also request background location (`ACCESS_BACKGROUND_LOCATION` on Android; an "Always" usage description in the Expo app config on iOS). If this proves too time-consuming to get right, foreground-only tracking is an acceptable fallback — just document the limitation clearly in the project writeup.
- `expo-speech` TTS output needs no special permission.
- Ensure the Expo app config includes correct permission usage-description strings and, if using the Google provider for `react-native-maps`, a valid Google Maps API key for Android.

## 9. Firebase Setup Checklist

1. Create a Firebase project; enable Email/Password Authentication.
2. Create a Cloud Firestore database (test mode while developing, then lock down before submission).
3. Firestore security rules: a user may read/write only their own `users/{uid}` document, and may only create/read `activities` documents where `resource.data.userId == request.auth.uid` (no update/delete needed for this scope).
4. `firebase init functions`; deploy the `generateWorkoutSummary` callable function with the LLM API key stored via `firebase functions:secrets:set`.
5. (Optional) Enable Firebase Storage only if map-snapshot thumbnails are added later.

## 10. Suggested Package List

`expo`, `expo-location`, `expo-speech`, `expo-sqlite`, `firebase` (modular v9+ SDK), `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`, `react-native-maps`, `react-native-maps-heatmap`, `zustand`, `@react-native-community/netinfo`, `date-fns`, `react-native-safe-area-context`, `react-native-screens`.

## 11. Suggested Development Phases

1. Project scaffold, navigation shell, and working Firebase Auth (Login/Signup end-to-end).
2. Core GPS tracking screen — start/stop, live map polyline, stats computation (no persistence yet).
3. Firestore save + History + Activity Detail screens (online-only first).
4. Offline-first layer: local SQLite queue + NetInfo-triggered sync.
5. AI-generated summaries via Cloud Function.
6. Gamification: badges, streak logic, and the Profile UI.
7. Voice pace coaching during active tracking.
8. Route heatmap screen.
9. Polish pass: consistent theming, loading/error states, Firestore security-rule hardening.

## 12. Explicitly Out of Scope

- Elevation tracking or an elevation profile.
- Social features — kudos, comments, friends, leaderboards.
- Real wearable or health-app integration.
- A km/mi unit toggle is optional/stretch, not required.

This specification is meant to be handed directly to a coding agent as the build brief: it should be specific enough to scaffold the project and implement each feature in the phase order above without needing to re-derive any scope decisions.

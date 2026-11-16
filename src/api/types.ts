/**
 * RunTrack domain types (spec §4).
 *
 * App-layer convention: times are epoch milliseconds and dates are "YYYY-MM-DD"
 * strings. The Firestore repositories (src/api/*) convert to/from Timestamps at
 * the boundary — nothing else in the app should construct Firestore types.
 */

export type ActivityType = 'run' | 'cycle' | 'walk';

/** A single GPS fix. `speed` is m/s from the location provider (optional). */
export interface RoutePoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed?: number;
}

/** `users/{uid}` document (spec §4). */
export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  /** Optional per spec; default 70. */
  weightKg: number;
  /** Epoch ms in app layer; Firestore Timestamp at rest. */
  createdAt?: number;
  totalDistanceKm: number;
  totalActivities: number;
  currentStreak: number;
  longestStreak: number;
  /** Local calendar day of the last logged activity, "YYYY-MM-DD". */
  lastActivityDate: string | null;
  /** Unlocked badge IDs (see src/services/gamification, ticket #020). */
  badges: string[];
}

/** `activities/{activityId}` document (spec §4). */
export interface Activity {
  id: string;
  userId: string;
  type: ActivityType;
  startTime: number;
  endTime: number;
  durationSec: number;
  distanceKm: number;
  avgPaceSecPerKm: number;
  caloriesEstimate: number;
  route: RoutePoint[];
  /** Filled post-save by the AI recap (ticket #019). */
  aiSummary?: string;
  /** Epoch ms in app layer; Firestore Timestamp at rest. */
  createdAt?: number;
}

/** Payload used when saving a new activity (epoch-ms times; repo converts). */
export interface ActivityInput {
  userId: string;
  type: ActivityType;
  startTime: number;
  endTime: number;
  durationSec: number;
  distanceKm: number;
  avgPaceSecPerKm: number;
  caloriesEstimate: number;
  route: RoutePoint[];
}

/** The frozen result of a finished tracking session (ticket #012 → #014). */
export interface SessionSnapshot {
  activityType: ActivityType;
  points: RoutePoint[];
  /** Preserve pause breaks for the review map; `points` is the flat storage route. */
  segments: RoutePoint[][];
  startedAt: number;
  endedAt: number;
  durationSec: number;
  distanceKm: number;
  avgPaceSecPerKm: number;
  caloriesEstimate: number;
}

/** Minimal identity kept in the auth store (never the full Firestore doc). */
export interface AuthUser {
  uid: string;
  email: string | null;
}

import { create } from 'zustand';
import type { ActivityType, RoutePoint, SessionSnapshot } from '../api/types';
import { computeSessionStats } from '../utils/stats';

/**
 * Live tracking session state machine (spec §3.2). Owns the session state and
 * pure state transitions only — it never touches location services, Firestore,
 * or the filesystem. The tracking engine (#010) feeds GPS points in via
 * appendPoint; voice-coach triggers read lastAnnouncedKm via
 * setLastAnnouncedKm (#023); the Summary screen consumes pendingSummary (#014).
 *
 * Date.now() is read only inside actions (the one store allowed to).
 */
export type TrackingStatus = 'idle' | 'recording' | 'paused';

export interface TrackingState {
  status: TrackingStatus;
  activityType: ActivityType;
  /** Route split by pauses → one Polyline per segment (#012). */
  segments: RoutePoint[][];
  /** Epoch ms; null while idle. */
  startedAt: number | null;
  /** Accumulated paused time across all completed pause spans. */
  totalPausedMs: number;
  /** Epoch ms of the open pause span; null while not paused. */
  pauseStartedAt: number | null;
  /** Last whole-km mark the voice coach announced (#023). */
  lastAnnouncedKm: number;
  /** One-time, time-based voice demo; never changes recorded GPS stats. */
  voiceDemoPlayed: boolean;
  /** Set on stop(), consumed (then reset()) by the Summary screen (#014). */
  pendingSummary: SessionSnapshot | null;
  start: (type: ActivityType) => void;
  pause: () => void;
  resume: () => void;
  appendPoint: (p: RoutePoint) => void;
  stop: (weightKg: number) => SessionSnapshot | null;
  reset: () => void;
  setLastAnnouncedKm: (km: number) => void;
  markVoiceDemoPlayed: () => void;
}

export const useTrackingStore = create<TrackingState>()((set, get) => ({
  status: 'idle',
  activityType: 'run',
  segments: [],
  startedAt: null,
  totalPausedMs: 0,
  pauseStartedAt: null,
  lastAnnouncedKm: 0,
  voiceDemoPlayed: false,
  pendingSummary: null,

  start: (type) => {
    // A finished run must be saved/discarded before another one can replace it.
    if (get().status !== 'idle' || get().pendingSummary !== null) return;
    set({
      status: 'recording',
      activityType: type,
      segments: [[]],
      startedAt: Date.now(),
      totalPausedMs: 0,
      pauseStartedAt: null,
      lastAnnouncedKm: 0,
      voiceDemoPlayed: false,
      pendingSummary: null,
    });
  },

  pause: () => {
    if (get().status !== 'recording') return;
    set({ status: 'paused', pauseStartedAt: Date.now() });
  },

  resume: () => {
    const { status, pauseStartedAt, totalPausedMs } = get();
    if (status !== 'paused') return;
    // Defensive: a 'paused' state always has pauseStartedAt, but never let a
    // missing one corrupt the total (adds 0 instead of a negative span).
    const folded =
      pauseStartedAt === null ? 0 : Math.max(0, Date.now() - pauseStartedAt);
    set({
      status: 'recording',
      totalPausedMs: totalPausedMs + folded,
      pauseStartedAt: null,
      // New empty segment: the polyline visually breaks across the pause (#012).
      segments: [...get().segments, []],
    });
  },

  appendPoint: (p) => {
    const { status, segments } = get();
    if (status !== 'recording') return;
    // Engine (#010) filters accuracy/speed; this is a blind append.
    const last = segments.length - 1;
    if (last < 0) {
      set({ segments: [[p]] });
      return;
    }
    set({ segments: [...segments.slice(0, last), [...segments[last], p]] });
  },

  stop: (weightKg) => {
    const { status, startedAt } = get();
    if (status === 'idle' || startedAt === null) return null;
    const endedAt = Date.now();
    let { totalPausedMs, pauseStartedAt } = get();
    // Fold the still-open pause span (if any) into the total so duration
    // excludes the trailing pause.
    if (status === 'paused' && pauseStartedAt !== null) {
      totalPausedMs += Math.max(0, endedAt - pauseStartedAt);
      pauseStartedAt = null;
    }
    const snapshot = computeSessionStats({
      type: get().activityType,
      segments: get().segments,
      startedAt,
      endedAt,
      totalPausedMs,
      weightKg,
    });
    set({
      status: 'idle',
      segments: [],
      startedAt: null,
      totalPausedMs: 0,
      pauseStartedAt: null,
      lastAnnouncedKm: 0,
      voiceDemoPlayed: false,
      pendingSummary: snapshot,
    });
    return snapshot;
  },

  reset: () =>
    set({
      status: 'idle',
      activityType: get().activityType,
      segments: [],
      startedAt: null,
      totalPausedMs: 0,
      pauseStartedAt: null,
      lastAnnouncedKm: 0,
      voiceDemoPlayed: false,
      pendingSummary: null,
    }),

  setLastAnnouncedKm: (km) => set({ lastAnnouncedKm: km }),
  markVoiceDemoPlayed: () => set({ voiceDemoPlayed: true }),
}));

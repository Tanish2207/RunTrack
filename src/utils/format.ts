import { format } from 'date-fns';

/**
 * Display formatters used by the live HUD and every stats grid (spec §3.3).
 * Pure; km-only — the unit toggle is spec §12 stretch and intentionally absent.
 */

/** `5.02 km` */
export function formatDistance(km: number): string {
  return `${km.toFixed(2)} km`;
}

/** `h:mm:ss`, e.g. `0:42:05` / `1:02:05`. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** `5:42 /km`, or `—` when the pace is 0/unknown (see MIN_PACE_DISTANCE_KM). */
export function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return '—';
  const s = Math.round(secPerKm);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')} /km`;
}

/** Spoken pace for TTS announcements (#023): "5 minutes 42 seconds per kilometer". */
export function paceToSpeech(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0 || secPerKm > 3600) return 'your current pace';
  const s = Math.round(secPerKm);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} ${r === 1 ? 'second' : 'seconds'} per kilometer`;
  if (r === 0) return `${m} ${m === 1 ? 'minute' : 'minutes'} per kilometer`;
  return `${m} ${m === 1 ? 'minute' : 'minutes'} ${r} ${r === 1 ? 'second' : 'seconds'} per kilometer`;
}

/** Human activity date for list rows: `Tue, Nov 10 · 7:02 AM`. */
export function formatDate(epochMs: number): string {
  const date = new Date(epochMs);
  return Number.isFinite(date.getTime()) ? format(date, 'EEE, MMM d · h:mm a') : 'Date unavailable';
}

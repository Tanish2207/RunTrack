import type { TextStyle } from 'react-native';

/**
 * RunTrack design tokens — the single source of truth for every visual value
 * in the app (ticket #002, spec §6 "General UI/UX notes").
 *
 * Components and screens must consume these through `src/theme` (the composed
 * `theme` object / `makeStyles` helper) — no raw hex colors, ad-hoc spacing
 * numbers, or magic radii anywhere else. One accent, one scale.
 */

/** Color palette. Strava-orange accent; everything else neutral. */
export const colors = {
  /** Strava orange — primary actions, active states, live accents. */
  accent: '#FC4C02',
  /** Primary foreground (near-black). */
  text: '#1A1D21',
  /** Secondary foreground — labels, hints, supporting copy. */
  textSecondary: '#6B7280',
  /** App background. */
  background: '#F6F7F8',
  /** Elevated surfaces — cards, inputs, toasts. */
  card: '#FFFFFF',
  /** Hairlines, separators, resting input borders. */
  border: '#E5E7EB',
  /** Positive feedback (saved, synced, PBs). */
  success: '#16A34A',
  /** Destructive actions and validation errors. */
  danger: '#DC2626',
  /** De-emphasised content — placeholders, disabled hints. */
  muted: '#9CA3AF',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Spacing scale: 4 / 8 / 12 / 16 / 24 / 32.
 * `xs` … `xxl`. Never use raw padding/margin numbers in feature code.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export type SpacingToken = keyof typeof spacing;

/** Corner radii: sm 8 (inputs), md 12 (cards/surfaces), full 999 (pills). */
export const radius = {
  sm: 8,
  md: 12,
  full: 999,
} as const;

export type RadiusToken = keyof typeof radius;

export interface TypeScaleStyle {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  lineHeight: number;
}

/**
 * Type scale with paired font weights:
 * caption 12/500 · body 14/400 · bodyLg 16/400 · title 18/600 ·
 * headline 24/700 · display 32/800.
 *
 * `numeric` is a modifier, not a size: spread it together with any size style
 * (e.g. `[t.typography.headline, t.typography.numeric]`) to get equal-width
 * digits so live timers/distances don't jitter as they tick.
 */
export const typography: Record<
  'caption' | 'body' | 'bodyLg' | 'title' | 'headline' | 'display',
  TypeScaleStyle
> & { numeric: TextStyle } = {
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  bodyLg: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  title: { fontSize: 18, fontWeight: '600', lineHeight: 24 },
  headline: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  display: { fontSize: 32, fontWeight: '800', lineHeight: 38 },
  numeric: { fontVariant: ['tabular-nums'] },
};

export type TypographyToken = keyof typeof typography;

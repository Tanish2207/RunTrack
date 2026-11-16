/**
 * RunTrack shared UI kit (ticket #002) — the only styling surface feature
 * screens should need. All visuals derive from `src/theme` tokens; screens
 * must not hardcode hex colors or ad-hoc spacing values.
 *
 * ## ActivityIndicator convention (spec §6)
 * Never block the whole screen for ordinary async operations. Prefer, in order:
 *   1. `<Button loading ... />` — inline spinner inside the action that is busy.
 *   2. A small inline `<ActivityIndicator size="small" color={theme.colors.accent} />`
 *      rendered in place of (or beside) just the affected section's content,
 *      e.g. inside a `Card` while history loads.
 *   3. A full-screen blocking overlay only for rare, truly global operations —
 *      none ships in this kit on purpose.
 * Loading buttons keep their width stable; never swap a spinner for the label
 * in a way that resizes the control.
 */

export { Screen, type ScreenProps } from './Screen';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { TextField, type TextFieldProps } from './TextField';
export { Card, type CardProps } from './Card';
export { StatTile, type StatTileProps } from './StatTile';
export { RouteMap } from './RouteMap';
export type { RouteMapProps, MapEdgePadding, PreviewLocation } from './RouteMap.types';
export { ActivityTypeSelector, ACTIVITY_LABELS } from './ActivityTypeSelector';
export { ActivityRow, type ActivityRowProps } from './ActivityRow';
export { SyncBanner } from './SyncBanner';
export { AiSummaryCard, type AiSummaryCardProps } from './AiSummaryCard';
export { LocationAccessNotice } from './LocationAccessNotice';
export { Toast } from './Toast';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Icon, type IconProps, type IconName } from './Icon';

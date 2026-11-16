import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from './tokens';

export { colors, radius, spacing, typography };
export type { ColorToken, RadiusToken, SpacingToken, TypographyToken } from './tokens';

/**
 * Composed design system. Import `theme` (or individual token groups) and
 * interpolate tokens inside `makeStyles` — never hardcode raw values.
 */
export const theme = { colors, spacing, radius, typography } as const;

export type Theme = typeof theme;

type NamedStyles<S> = { [K in keyof S]: ViewStyle | TextStyle | ImageStyle };

/**
 * Minimal styling helper (no styling libraries): build a `StyleSheet` once at
 * module scope, with the theme passed in for token interpolation, and get back
 * a hook that hands it to components.
 *
 * Usage:
 *   const useStyles = makeStyles((t) => ({
 *     card: { backgroundColor: t.colors.card, borderRadius: t.radius.md },
 *   }));
 *   // in a component:
 *   const styles = useStyles();
 */
export function makeStyles<S extends NamedStyles<S>>(build: (t: Theme) => S): () => S {
  const sheet = StyleSheet.create(build(theme));
  return () => sheet;
}

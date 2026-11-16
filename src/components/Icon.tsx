import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import type { ColorValue, StyleProp, TextStyle } from 'react-native';
import { theme } from '../theme';

/** Every icon in the app comes from the MaterialCommunityIcons family (spec §6). */
export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface IconProps {
  name: IconName;
  /** Rendered size in px; kit default 20. */
  size?: number;
  /** Color token value; defaults to the primary text color. */
  color?: ColorValue;
  style?: StyleProp<TextStyle>;
}

/**
 * Thin wrapper around `@expo/vector-icons` MaterialCommunityIcons so the kit
 * (and feature code) has one consistent icon entry point with token defaults.
 */
export function Icon({ name, size = 20, color = theme.colors.text, style }: IconProps) {
  // RN 0.88 also accepts numeric native colors; the icon's legacy color prop
  // does not. TextStyle supports the full ColorValue union on every platform.
  return <MaterialCommunityIcons name={name} size={size} style={[{ color: color ?? theme.colors.text }, style]} />;
}

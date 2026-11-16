import { DefaultTheme } from 'expo-router';
import { theme } from '../theme';

/** Expo Router owns the container; its theme still follows our UI tokens. */
export const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: theme.colors.accent,
    background: theme.colors.background,
    card: theme.colors.card,
    text: theme.colors.text,
    border: theme.colors.border,
    notification: theme.colors.accent,
  },
};

export const stackScreenOptions = {
  headerStyle: { backgroundColor: theme.colors.card },
  headerTintColor: theme.colors.text,
  headerTitleStyle: theme.typography.title,
  headerTransparent: false,
  contentStyle: { backgroundColor: theme.colors.background },
};

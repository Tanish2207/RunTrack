import { StyleSheet, Text, View } from 'react-native';
import { makeStyles, spacing, theme } from '../theme';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  /** MaterialCommunityIcons glyph (e.g. 'run-fast', 'map-marker-offline', 'wifi-off'). */
  icon?: IconName;
  title: string;
  message?: string;
}

/** Centered "nothing here yet" block: icon bubble + title + optional body. */
export function EmptyState({ icon, title, message }: EmptyStateProps) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      {icon ? (
        <View style={styles.iconBubble}>
          <Icon name={icon} size={26} color={theme.colors.accent} />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    alignItems: 'center',
    padding: t.spacing.xl,
    gap: t.spacing.sm,
  },
  iconBubble: {
    // 56 = 32 + 24 (two spacing steps) — comfortable icon target.
    width: spacing.xxl + spacing.xl,
    height: spacing.xxl + spacing.xl,
    borderRadius: t.radius.full,
    backgroundColor: t.colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...t.typography.title,
    color: t.colors.text,
    textAlign: 'center',
  },
  message: {
    ...t.typography.body,
    color: t.colors.textSecondary,
    textAlign: 'center',
  },
}));

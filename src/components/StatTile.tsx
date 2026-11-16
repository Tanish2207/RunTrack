import { StyleSheet, Text, View } from 'react-native';
import { makeStyles, theme } from '../theme';
import { Icon, type IconName } from './Icon';

export interface StatTileProps {
  value: string;
  label: string;
  /** Optional MaterialCommunityIcons glyph (e.g. 'runner', 'bike', 'walk'). */
  icon?: IconName;
}

/**
 * Compact stat surface for stats grids (home dashboard, run summaries).
 * The value renders with tabular digits so live timers/distances tick without
 * the digits wobbling — pair with `theme.typography.numeric` anywhere else.
 */
export function StatTile({ value, label, icon }: StatTileProps) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      {icon ? <Icon name={icon} size={18} color={theme.colors.accent} /> : null}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  tile: {
    backgroundColor: t.colors.card,
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
    padding: t.spacing.lg,
    alignItems: 'flex-start',
    gap: t.spacing.sm,
  },
  value: {
    ...t.typography.headline,
    ...t.typography.numeric,
    color: t.colors.text,
  },
  label: {
    ...t.typography.caption,
    color: t.colors.textSecondary,
  },
}));

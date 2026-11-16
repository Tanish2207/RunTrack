import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ActivityType } from '../api/types';
import { makeStyles, theme } from '../theme';
import { Icon, type IconName } from './Icon';

export const ACTIVITY_LABELS: Record<ActivityType, string> = { run: 'Run', cycle: 'Cycle', walk: 'Walk' };
const ACTIVITY_ICONS: Record<ActivityType, IconName> = { run: 'run-fast', cycle: 'bike', walk: 'walk' };
const ACTIVITY_TYPES: ActivityType[] = ['run', 'cycle', 'walk'];

export function ActivityTypeSelector({ value, onChange, disabled = false }: {
  value: ActivityType;
  onChange: (type: ActivityType) => void;
  disabled?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Activity type">
      {ACTIVITY_TYPES.map((type) => {
        const selected = value === type;
        return (
          <Pressable
            key={type}
            accessibilityRole="radio"
            accessibilityLabel={ACTIVITY_LABELS[type]}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(type)}
            style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
          >
            <Icon name={ACTIVITY_ICONS[type]} color={selected ? theme.colors.accent : theme.colors.textSecondary} />
            <Text style={[styles.label, selected && styles.selectedLabel]}>{ACTIVITY_LABELS[type]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', gap: t.spacing.sm },
  chip: {
    flex: 1, minHeight: t.spacing.xxl + t.spacing.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
    borderRadius: t.radius.sm, padding: t.spacing.sm,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: t.spacing.xs,
  },
  selected: { borderColor: t.colors.accent, backgroundColor: t.colors.background },
  pressed: { opacity: 0.7 },
  label: { ...t.typography.body, fontWeight: '600', color: t.colors.textSecondary },
  selectedLabel: { color: t.colors.accent },
}));

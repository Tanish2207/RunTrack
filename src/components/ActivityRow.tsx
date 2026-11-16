import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Activity, ActivityType } from '../api/types';
import { makeStyles, theme } from '../theme';
import { formatDate, formatDistance, formatDuration, formatPace } from '../utils/format';
import { ACTIVITY_LABELS } from './ActivityTypeSelector';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';

const ACTIVITY_ICONS: Record<ActivityType, IconName> = { run: 'run-fast', cycle: 'bike', walk: 'walk' };

export interface ActivityRowProps {
  activity: Activity;
  onPress: () => void;
}

/** Stored stats only; flexible row height accommodates narrow screens/text scaling. */
export const ActivityRow = memo(function ActivityRow({ activity, onPress }: ActivityRowProps) {
  const styles = useStyles();
  const label = ACTIVITY_LABELS[activity.type];
  const date = formatDate(activity.startTime);
  const distance = formatDistance(activity.distanceKm);
  const duration = formatDuration(activity.durationSec);
  const pace = formatPace(activity.avgPaceSecPerKm);

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${date}, distance ${distance}, duration ${duration}, average pace ${pace}`}
      accessibilityHint="Opens the saved activity details"
      onPress={onPress}
      style={({ pressed }) => [styles.touchTarget, pressed && styles.pressed]}
    >
      <Card style={styles.card}>
        <View style={styles.heading}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name={ACTIVITY_ICONS[activity.type]} size={theme.spacing.xl} color={theme.colors.accent} />
          </View>
          <View style={styles.headingText}>
            <Text style={styles.type}>{label}</Text>
            <Text style={styles.date}>{date}</Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="chevron-right" color={theme.colors.textSecondary} />
          </View>
        </View>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.value}>{distance}</Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.value}>{duration}</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.value}>{pace}</Text>
            <Text style={styles.statLabel}>Avg pace</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
});

const useStyles = makeStyles((t) => ({
  touchTarget: { minHeight: t.spacing.xxl + t.spacing.lg, borderRadius: t.radius.md },
  pressed: { opacity: 0.85 },
  card: { gap: t.spacing.md },
  heading: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  headingText: { flex: 1, gap: t.spacing.xs },
  type: { ...t.typography.title, color: t.colors.text },
  date: { ...t.typography.body, color: t.colors.textSecondary, flexShrink: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md },
  stat: { flexGrow: 1, flexShrink: 1, flexBasis: t.spacing.xxl * 3, gap: t.spacing.xs },
  value: { ...t.typography.bodyLg, ...t.typography.numeric, fontWeight: '600', color: t.colors.text },
  statLabel: { ...t.typography.caption, color: t.colors.textSecondary },
}));

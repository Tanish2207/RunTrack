import { useMemo } from 'react';
import { format } from 'date-fns';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import type { ActivityType } from '../../api/types';
import {
  ACTIVITY_LABELS, AiSummaryCard, Button, Card, EmptyState, Icon, RouteMap, Screen, StatTile,
  type IconName,
} from '../../components';
import { useActivityDetail } from '../../hooks/useActivityDetail';
import { makeStyles, theme } from '../../theme';
import { formatDate, formatDistance, formatDuration, formatPace } from '../../utils/format';

const ACTIVITY_ICONS: Record<ActivityType, IconName> = { run: 'run-fast', cycle: 'bike', walk: 'walk' };

export default function ActivityDetailScreen() {
  const { activityId } = useLocalSearchParams<{ activityId?: string | string[] }>();
  const router = useRouter();
  const { state, retry, isCurrent } = useActivityDetail(activityId);
  const styles = useStyles();
  const activity = state.status === 'ready' ? state.activity : null;
  // Persistence stores one flat route, not the exact pause-separated review segments.
  const route = activity?.route;
  const segments = useMemo(() => route ? [route] : [], [route]);
  const label = activity ? ACTIVITY_LABELS[activity.type] : null;
  const startDate = activity ? new Date(activity.startTime) : null;
  const shortDate = startDate && Number.isFinite(startDate.getTime())
    ? format(startDate, 'MMM d, yyyy')
    : 'Date unavailable';
  const title = activity ? `${label} · ${shortDate}` : 'Activity';

  function backToHistory() {
    if (isCurrent()) router.dismissTo('/(tabs)/history');
  }

  return (
    <Screen scroll edges={[]} style={styles.content}>
      <Stack.Screen options={{ title }} />
      {activity ? (
        <>
          <View style={styles.heading}>
            <View style={styles.badge} accessible accessibilityLabel={`${label} activity`}>
              <Icon name={ACTIVITY_ICONS[activity.type]} size={theme.spacing.xl} color={theme.colors.accent} />
              <Text style={styles.badgeLabel}>{label}</Text>
            </View>
            <Text style={styles.body}>{formatDate(activity.startTime)}</Text>
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">Saved route</Text>
            <View style={styles.map}>
              {activity.route.length > 0 ? (
                <RouteMap key={activity.id} segments={segments} fitRoute interactive showsUserLocation={false} follow={false} />
              ) : (
                <View style={styles.emptyRoute}>
                  <Icon name="map-marker-off-outline" color={theme.colors.textSecondary} />
                  <Text style={styles.routeNotice}>No route points were saved for this activity.</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.grid}>
            <View style={styles.tile}><StatTile value={formatDistance(activity.distanceKm)} label="Distance" icon="map-marker-distance" /></View>
            <View style={styles.tile}><StatTile value={formatDuration(activity.durationSec)} label="Duration" icon="timer-outline" /></View>
            <View style={styles.tile}><StatTile value={formatPace(activity.avgPaceSecPerKm)} label="Avg pace" icon="speedometer" /></View>
            <View style={styles.tile}><StatTile value={`${Math.round(activity.caloriesEstimate)} kcal`} label="Est. calories" icon="fire" /></View>
          </View>
          {activity.aiSummary?.trim() ? <AiSummaryCard state="ready" summary={activity.aiSummary} /> : null}
        </>
      ) : (
        <Card style={styles.stateCard}>
          {state.status === 'loading' ? (
            <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading saved activity" accessibilityState={{ busy: true }}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={styles.body}>Loading saved activity…</Text>
            </View>
          ) : state.status === 'signed-out' ? (
            <EmptyState icon="account-outline" title="Sign in to view activities" message="Your saved activities are available after you sign in. Return to History to continue." />
          ) : state.status === 'error' ? (
            <View accessibilityRole="alert">
              <EmptyState icon="wifi-off" title="Could not load activity" message={state.message} />
            </View>
          ) : (
            <EmptyState icon="map-marker-off-outline" title="Activity not found" message="This activity is not available. Return to History to choose another saved activity." />
          )}
          {state.status === 'error' ? <Button label="Retry" onPress={retry} /> : null}
        </Card>
      )}
      <Button label="Back to History" variant="secondary" onPress={backToHistory} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  content: { gap: t.spacing.lg },
  heading: { gap: t.spacing.sm, alignItems: 'flex-start' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, borderRadius: t.radius.full, backgroundColor: t.colors.card, paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm },
  badgeLabel: { ...t.typography.title, color: t.colors.accent },
  body: { ...t.typography.body, color: t.colors.textSecondary },
  section: { gap: t.spacing.sm },
  sectionTitle: { ...t.typography.title, color: t.colors.text },
  map: { width: '100%', aspectRatio: 1.5, overflow: 'hidden', borderRadius: t.radius.md, backgroundColor: t.colors.card },
  emptyRoute: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm, padding: t.spacing.lg },
  routeNotice: { ...t.typography.body, color: t.colors.textSecondary, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md },
  tile: { flexBasis: '46%', flexGrow: 1 },
  stateCard: { gap: t.spacing.md },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing.sm, padding: t.spacing.xl },
}));

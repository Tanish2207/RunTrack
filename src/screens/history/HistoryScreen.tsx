import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Text, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import type { Activity } from '../../api/types';
import { Button, EmptyState } from '../../components';
import { ActivityRow } from '../../components/ActivityRow';
import { SyncBanner } from '../../components/SyncBanner';
import { useActivityHistory } from '../../hooks/useActivityHistory';
import { makeStyles, theme } from '../../theme';

const activityKey = (activity: Activity) => activity.id;

function RowSeparator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

export default function HistoryScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { activities, status, error, retry, isCurrent, canOpenActivity } = useActivityHistory();

  const renderItem = useCallback<ListRenderItem<Activity>>(({ item }) => {
    return (
      <ActivityRow
        activity={item}
        onPress={() => {
          if (!canOpenActivity(item)) return;
          router.push({
            pathname: '/(tabs)/history/[activityId]',
            params: { activityId: item.id },
          }, { withAnchor: true });
        }}
      />
    );
  }, [canOpenActivity, router]);

  const goToTrack = useCallback(() => {
    if (isCurrent()) router.navigate('/(tabs)/track');
  }, [isCurrent, router]);

  const emptyContent = status === 'loading' ? (
    <View style={styles.state}>
      <ActivityIndicator size="small" color={theme.colors.accent} accessibilityLabel="Loading activities" />
      <Text style={styles.message}>Loading activities…</Text>
    </View>
  ) : status === 'error' ? (
    <View style={styles.state}>
      <EmptyState icon="wifi-off" title="Couldn't load activities" />
      <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
      <Button label="Retry" variant="secondary" onPress={retry} />
    </View>
  ) : status === 'ready' ? (
    <View style={styles.state}>
      <EmptyState
        icon="history"
        title="No activities yet"
        message="Tap Track to start a run, cycle, or walk. Your saved activities will appear here."
      />
      <Button label="Go to Track" onPress={goToTrack} />
    </View>
  ) : null;

  return (
    // Keep the list on the first-descendant chain for native large-title scrolling.
    <SafeAreaView edges={[]} collapsable={false} style={styles.root}>
      <FlatList
        style={styles.fill}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={activities}
        renderItem={renderItem}
        keyExtractor={activityKey}
        ListHeaderComponent={SyncBanner}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={emptyContent ?? undefined}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.xl },
  separator: { height: t.spacing.md },
  state: { alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.xxl },
  message: { ...t.typography.body, color: t.colors.textSecondary, textAlign: 'center' },
  error: { ...t.typography.body, color: t.colors.danger, textAlign: 'center' },
}));

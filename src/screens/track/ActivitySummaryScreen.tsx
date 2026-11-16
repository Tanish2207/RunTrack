import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, usePreventRemove, useRouter } from 'expo-router';
import { ACTIVITY_LABELS, AiSummaryCard, Button, Card, RouteMap, Screen, StatTile } from '../../components';
import { discardPendingActivity, savePendingActivity } from '../../services/activityReview';
import { useAuthStore } from '../../stores/authStore';
import { useTrackingStore } from '../../stores/trackingStore';
import { useUiStore } from '../../stores/uiStore';
import { makeStyles } from '../../theme';
import { confirmDestructiveAction } from '../../utils/confirm';
import { formatDistance, formatDuration, formatPace } from '../../utils/format';

export default function ActivitySummaryScreen() {
  const router = useRouter();
  const pendingSummary = useTrackingStore((state) => state.pendingSummary);
  const userId = useAuthStore((state) => state.user?.uid);
  const [retainedSnapshot, setRetainedSnapshot] = useState(pendingSummary);
  const [saving, setSaving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const confirming = useRef(false);
  const mounted = useRef(false);
  const styles = useStyles();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disablePrevention = usePreventRemove(saving && !resolved, () => {
    useUiStore.getState().showToast('Saving your activity. Please wait before leaving review.', 'info');
  });
  // Keep rendering the captured review between a successful store reset and
  // navigation. Ordinary back/tab navigation never clears pendingSummary.
  const snapshot = pendingSummary ?? ((saving || resolved) ? retainedSnapshot : null);

  function leaveReview(saved: boolean) {
    setResolved(true);
    disablePrevention();
    // Unwind this stack explicitly before selecting a different tab. A
    // cross-tab replace alone leaves the resolved review in the Track stack.
    router.dismissTo('/(tabs)/track');
    if (saved) router.navigate('/(tabs)/history');
  }

  async function handleSave() {
    if (busy.current || confirming.current || resolved || !snapshot ||
      useTrackingStore.getState().pendingSummary !== snapshot) return;
    busy.current = true;
    setRetainedSnapshot(snapshot);
    setSaving(true);
    setError(null);
    try {
      const outcome = await savePendingActivity();
      const state = useTrackingStore.getState();
      if (!mounted.current || useAuthStore.getState().user?.uid !== userId ||
        state.pendingSummary !== null || state.status !== 'idle') return;
      // #016: an offline save already landed in the local queue; #017 syncs it.
      useUiStore.getState().showToast(
        outcome.firestoreId ? 'Activity saved' : 'Activity saved (offline — will sync)',
        'success',
      );
      leaveReview(true);
    } catch (failure) {
      if (!mounted.current || useAuthStore.getState().user?.uid !== userId ||
        useTrackingStore.getState().pendingSummary !== snapshot) return;
      setError(failure instanceof Error ? failure.message : 'Check your connection and try again.');
      useUiStore.getState().showToast('Save failed — activity kept on screen; try again.', 'error');
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function askToDiscard() {
    if (busy.current || confirming.current || resolved || !snapshot) return;
    confirming.current = true;
    confirmDestructiveAction({
      title: 'Discard activity?', message: 'This activity will not be saved.',
      cancelLabel: 'Keep editing', confirmLabel: 'Discard',
      onCancel: () => { confirming.current = false; },
      onConfirm: () => {
        confirming.current = false;
        // An OS dialog can outlive logout or a replaced review.
        if (!mounted.current || busy.current || useAuthStore.getState().user?.uid !== userId ||
          useTrackingStore.getState().pendingSummary !== snapshot) return;
        setRetainedSnapshot(snapshot);
        if (!discardPendingActivity()) return;
        leaveReview(false);
      },
    });
  }

  if (!snapshot) return <Redirect href="/(tabs)/track" />;

  return (
    <Screen scroll edges={[]} style={styles.content}>
      <View style={styles.heading}>
        <Text style={styles.title}>{ACTIVITY_LABELS[snapshot.activityType]} complete</Text>
        <Text style={styles.body}>Review your activity before saving. Nothing has been committed yet.</Text>
      </View>
      <View style={styles.map}>
        <RouteMap segments={snapshot.segments} fitRoute />
        {snapshot.points.length === 0 ? (
          <View style={styles.emptyRoute}><Text style={styles.body}>No precise route points were recorded.</Text></View>
        ) : null}
      </View>
      <View style={styles.grid}>
        <View style={styles.tile}><StatTile value={formatDistance(snapshot.distanceKm)} label="Distance" icon="map-marker-distance" /></View>
        <View style={styles.tile}><StatTile value={formatDuration(snapshot.durationSec)} label="Duration" icon="timer-outline" /></View>
        <View style={styles.tile}><StatTile value={formatPace(snapshot.avgPaceSecPerKm)} label="Avg pace" icon="speedometer" /></View>
        <View style={styles.tile}><StatTile value={`${Math.round(snapshot.caloriesEstimate)} kcal`} label="Est. calories" icon="fire" /></View>
      </View>
      <AiSummaryCard state="hidden" />
      {error ? (
        <Card>
          <Text style={styles.error} accessibilityRole="alert">{error}</Text>
          <Text style={styles.body}>Your activity is kept here for retry.</Text>
        </Card>
      ) : null}
      <Button label="Save Activity" onPress={() => void handleSave()} loading={saving} disabled={resolved} />
      <Button label="Discard" variant="secondary" onPress={askToDiscard} disabled={saving || resolved} />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  content: { gap: t.spacing.lg },
  heading: { gap: t.spacing.sm },
  title: { ...t.typography.headline, color: t.colors.text },
  body: { ...t.typography.body, color: t.colors.textSecondary },
  map: { width: '100%', aspectRatio: 1.5, overflow: 'hidden', borderRadius: t.radius.md, backgroundColor: t.colors.card },
  emptyRoute: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.background, padding: t.spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md },
  tile: { flexBasis: '46%', flexGrow: 1 },
  error: { ...t.typography.body, color: t.colors.danger, marginBottom: t.spacing.sm },
}));

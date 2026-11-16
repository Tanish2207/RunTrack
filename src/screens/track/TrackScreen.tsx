import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ActivityType } from '../../api/types';
import {
  ActivityTypeSelector, Button, Card, Icon, LocationAccessNotice, RouteMap,
  type PreviewLocation,
} from '../../components';
import { useForegroundLocation } from '../../hooks/useForegroundLocation';
import { startTracking, TrackingError } from '../../services/locationTracking';
import { useTrackingStore } from '../../stores/trackingStore';
import { useUiStore } from '../../stores/uiStore';
import { makeStyles, theme } from '../../theme';
import { MAX_GPS_ACCURACY_METERS } from '../../utils/locationFix';

export default function TrackScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const access = useForegroundLocation();
  const status = useTrackingStore((state) => state.status);
  const pendingSummary = useTrackingStore((state) => state.pendingSummary);
  const [type, setType] = useState<ActivityType>('run');
  const [preview, setPreview] = useState<PreviewLocation | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(false);
  const isFocused = useRef(focused);
  const styles = useStyles();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { isFocused.current = focused; }, [focused]);

  const padding = useMemo(() => ({
    top: insets.top + theme.spacing.xxl * 3,
    right: theme.spacing.lg, bottom: panelHeight + theme.spacing.lg, left: theme.spacing.lg,
  }), [insets.top, panelHeight]);

  async function handleStart() {
    if (busy.current) return;
    const state = useTrackingStore.getState();
    if (state.pendingSummary) { router.push('/(tabs)/track/summary', { withAnchor: true }); return; }
    if (state.status !== 'idle') { router.push('/(tabs)/track/active', { withAnchor: true }); return; }
    if (access.permission !== 'granted' || access.checking) return;

    busy.current = true;
    setStarting(true);
    setStartError(null);
    try {
      await startTracking(type);
      if (isFocused.current && useTrackingStore.getState().status !== 'idle') {
        router.push('/(tabs)/track/active', { withAnchor: true });
      }
    } catch (error) {
      if (error instanceof TrackingError && error.code === 'cancelled') return;
      const message = error instanceof Error ? error.message : 'Could not start GPS. Try again.';
      if (mounted.current) setStartError(message);
      useUiStore.getState().showToast(message, 'error');
      if (error instanceof TrackingError && error.code.startsWith('permission-')) void access.recheck();
    } finally {
      busy.current = false;
      if (mounted.current) setStarting(false);
    }
  }

  const hasSession = status !== 'idle';
  const hasReview = pendingSummary !== null;
  const accuracyHint = preview?.accuracy === null || !preview
    ? 'Acquiring GPS. Only precise fixes will be recorded.'
    : preview.accuracy <= MAX_GPS_ACCURACY_METERS
      ? `GPS accuracy ±${Math.round(preview.accuracy)} m`
      : 'GPS is not precise yet. Move outdoors or enable Precise Location.';

  return (
    <View style={styles.screen}>
      <RouteMap
        showsUserLocation={focused && access.permission === 'granted'}
        follow={focused}
        onLocationChange={setPreview}
        edgePadding={padding}
      />
      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top + theme.spacing.lg }]}>
        <Card style={styles.heading}>
          <Icon name="run-fast" size={theme.spacing.xl} color={theme.colors.accent} />
          <View>
            <Text style={styles.title}>RunTrack</Text>
            <Text style={styles.body}>Your next activity starts here.</Text>
          </View>
        </Card>

        <ScrollView
          style={styles.panelViewport}
          onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.panel}>
            <Text style={styles.title}>{hasReview ? 'Activity ready for review' : hasSession ? 'Your activity is still open' : 'Ready to move?'}</Text>
            {hasReview || hasSession ? (
              <Text style={styles.body}>
                {hasReview ? 'Save or discard your finished activity before starting another.' : 'Continue to the live controls. Paused activities only resume when you tap Resume.'}
              </Text>
            ) : <ActivityTypeSelector value={type} onChange={setType} disabled={starting} />}

            {!hasReview && !hasSession ? (
              <LocationAccessNotice permission={access.permission} checking={access.checking} error={access.error} onRetry={access.refresh} />
            ) : null}
            {!hasReview && access.permission === 'granted' ? <Text style={styles.hint}>{accuracyHint}</Text> : null}
            {startError ? <Text style={styles.error} accessibilityRole="alert">{startError}</Text> : null}
            <Button
              label={hasReview ? 'Review activity' : hasSession ? 'Continue activity' : `Start ${type === 'cycle' ? 'Cycle' : type === 'walk' ? 'Walk' : 'Run'}`}
              onPress={() => void handleStart()}
              loading={starting}
              disabled={!hasReview && !hasSession && (access.permission !== 'granted' || access.checking)}
            />
            <Text style={styles.hint}>Keep RunTrack open while recording. No background tracking.</Text>
          </Card>
        </ScrollView>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.background },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.lg },
  heading: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: t.spacing.md, marginBottom: t.spacing.lg },
  panelViewport: { flexGrow: 0, flexShrink: 1 },
  panel: { gap: t.spacing.md },
  title: { ...t.typography.title, color: t.colors.text },
  body: { ...t.typography.body, color: t.colors.textSecondary },
  hint: { ...t.typography.caption, color: t.colors.textSecondary },
  error: { ...t.typography.body, color: t.colors.danger },
}));

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useIsFocused, usePreventRemove, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACTIVITY_LABELS, Button, Card, Icon, LocationAccessNotice, RouteMap } from '../../components';
import { useForegroundLocation } from '../../hooks/useForegroundLocation';
import {
  pauseTracking, resumeTracking, stopTracking, TrackingError, useElapsedMs,
} from '../../services/locationTracking';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTrackingStore } from '../../stores/trackingStore';
import { useUiStore } from '../../stores/uiStore';
import { makeStyles, theme } from '../../theme';
import { confirmDestructiveAction } from '../../utils/confirm';
import { formatDistance, formatDuration, formatPace } from '../../utils/format';
import { computeSegmentDistanceKm, lastRoutePoint } from '../../utils/geo';
import { currentPaceSecPerKm, PACE_FIX_MAX_AGE_MS } from '../../utils/tracking';

export default function ActiveTrackingScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const access = useForegroundLocation();
  const status = useTrackingStore((state) => state.status);
  const activityType = useTrackingStore((state) => state.activityType);
  const segments = useTrackingStore((state) => state.segments);
  const startedAt = useTrackingStore((state) => state.startedAt);
  const totalPausedMs = useTrackingStore((state) => state.totalPausedMs);
  const pendingSummary = useTrackingStore((state) => state.pendingSummary);
  const voiceEnabled = useSettingsStore((state) => state.voiceCoachingEnabled);
  const toggleVoice = useSettingsStore((state) => state.setVoiceCoachingEnabled);
  const settingsWeight = useSettingsStore((state) => state.weightKg);
  const profileWeight = useAuthStore((state) => state.profile?.weightKg);
  const elapsedMs = useElapsedMs(focused);
  const [resuming, setResuming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const resumingRef = useRef(false);
  const confirming = useRef(false);
  const mounted = useRef(false);
  const styles = useStyles();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disablePrevention = usePreventRemove(status !== 'idle' && !leaving, () => askToFinish());

  const distanceKm = useMemo(() => computeSegmentDistanceKm(segments), [segments]);
  const latest = useMemo(() => lastRoutePoint(segments), [segments]);
  const currentSegment = segments[segments.length - 1] ?? [];
  const durationSec = Math.round(elapsedMs / 1000);
  const now = (startedAt ?? 0) + totalPausedMs + elapsedMs;
  const pace = status === 'recording' ? currentPaceSecPerKm(currentSegment, durationSec, distanceKm, now) : 0;
  const padding = useMemo(() => ({
    top: insets.top + theme.spacing.xxl * 3,
    right: theme.spacing.lg, bottom: panelHeight + theme.spacing.lg, left: theme.spacing.lg,
  }), [insets.top, panelHeight]);

  async function togglePause() {
    if (resumingRef.current) return;
    if (useTrackingStore.getState().status === 'recording') { pauseTracking(); return; }
    resumingRef.current = true;
    setResuming(true);
    try { await resumeTracking(); }
    catch (error) {
      if (error instanceof TrackingError && error.code === 'cancelled') return;
      useUiStore.getState().showToast(error instanceof Error ? error.message : 'Could not resume GPS. Check location access and retry.', 'error');
      if (error instanceof TrackingError && error.code.startsWith('permission-')) void access.recheck();
    } finally {
      resumingRef.current = false;
      if (mounted.current) setResuming(false);
    }
  }

  function askToFinish() {
    if (confirming.current || useTrackingStore.getState().status === 'idle') return;
    const startedAt = useTrackingStore.getState().startedAt;
    const userId = useAuthStore.getState().user?.uid;
    confirming.current = true;
    confirmDestructiveAction({
      title: 'Finish activity?',
      message: 'Your route and stats will be kept for review. Nothing is saved until you tap Save Activity.',
      cancelLabel: 'Keep tracking', confirmLabel: 'Finish',
      onCancel: () => { confirming.current = false; },
      onConfirm: () => {
        confirming.current = false;
        if (!mounted.current || useAuthStore.getState().user?.uid !== userId ||
          useTrackingStore.getState().startedAt !== startedAt) return;
        const snapshot = stopTracking(profileWeight ?? settingsWeight);
        if (!snapshot) return;
        setLeaving(true);
        disablePrevention();
        router.replace('/(tabs)/track/summary');
      },
    });
  }

  if (status === 'idle' && !leaving) return <Redirect href={pendingSummary ? '/(tabs)/track/summary' : '/(tabs)/track'} />;

  return (
    <View style={styles.screen}>
      <RouteMap segments={segments} currentPoint={latest} showsUserLocation={focused && access.permission === 'granted'} follow={focused} edgePadding={padding} />
      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: insets.top + theme.spacing.lg }]}>
        <View style={styles.topRow}>
          <Card style={styles.heading}>
            <Icon name={status === 'paused' ? 'pause-circle' : 'record-circle'} color={status === 'paused' ? theme.colors.muted : theme.colors.success} />
            <View style={styles.grow}>
              <Text style={styles.title}>{ACTIVITY_LABELS[activityType]} activity</Text>
              <Text style={styles.hint}>{status === 'paused' ? 'Paused — tap Resume when ready' : 'Recording your route'}</Text>
            </View>
          </Card>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Voice coaching"
            accessibilityState={{ checked: voiceEnabled }}
            accessibilityHint={voiceEnabled ? 'Tap to mute voice coaching' : 'Tap to enable voice coaching'}
            onPress={() => toggleVoice(!voiceEnabled)}
            style={({ pressed }) => [styles.mute, pressed && styles.pressed]}
          >
            <Icon name={voiceEnabled ? 'volume-high' : 'volume-off'} size={theme.spacing.xl} color={voiceEnabled ? theme.colors.accent : theme.colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.panelViewport}
          onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.panel}>
            {status === 'paused' ? <Text style={styles.paused}>PAUSED</Text> : null}
            <Text style={styles.elapsed}>{formatDuration(durationSec)}</Text>
            <Text style={styles.hint}>Active time</Text>
            <View style={styles.stats}>
              <View style={styles.grow}>
                <Text style={styles.value}>{formatDistance(distanceKm)}</Text>
                <Text style={styles.hint}>Distance</Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.value}>{formatPace(pace)}</Text>
                <Text style={styles.hint}>Current pace</Text>
              </View>
            </View>
            <LocationAccessNotice permission={access.permission} checking={access.checking} error={access.error} onRetry={access.refresh} />
            {status === 'recording' && currentSegment.length === 0 ? (
              <Text style={styles.hint}>Waiting for a precise GPS fix…</Text>
            ) : status === 'recording' && latest && now - latest.timestamp > PACE_FIX_MAX_AGE_MS ? (
              <Text style={styles.hint}>GPS signal is weak. Only precise fixes are recorded.</Text>
            ) : null}
            <View style={styles.controls}>
              <Button label={status === 'paused' ? 'Resume' : 'Pause'} variant="secondary" onPress={() => void togglePause()} loading={resuming} disabled={status === 'paused' && (access.checking || access.permission !== 'granted')} style={styles.grow} />
              <Button label="Stop" variant="destructive" onPress={askToFinish} style={styles.grow} />
            </View>
            <Text style={styles.hint}>Keep RunTrack open. Returning from the background requires Resume.</Text>
          </Card>
        </ScrollView>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: { flex: 1, backgroundColor: t.colors.background },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginBottom: t.spacing.lg },
  panelViewport: { flexGrow: 0, flexShrink: 1 },
  heading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  mute: { width: t.spacing.xxl + t.spacing.lg, height: t.spacing.xxl + t.spacing.lg, borderRadius: t.radius.full, backgroundColor: t.colors.card, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  panel: { gap: t.spacing.sm },
  title: { ...t.typography.title, color: t.colors.text },
  hint: { ...t.typography.caption, color: t.colors.textSecondary },
  elapsed: { ...t.typography.display, ...t.typography.numeric, color: t.colors.text },
  value: { ...t.typography.headline, ...t.typography.numeric, color: t.colors.text },
  paused: { ...t.typography.caption, color: t.colors.danger },
  stats: { flexDirection: 'row', gap: t.spacing.lg, marginVertical: t.spacing.md },
  controls: { flexDirection: 'row', gap: t.spacing.md, marginTop: t.spacing.sm },
}));

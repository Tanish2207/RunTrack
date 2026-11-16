import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { openLocationSettings, type ForegroundLocationPermission } from '../services/permissions';
import { useUiStore } from '../stores/uiStore';
import { makeStyles, theme } from '../theme';
import { Button } from './Button';

export function LocationAccessNotice({ permission, checking, error, onRetry }: {
  permission: ForegroundLocationPermission | null;
  checking: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  const [openingSettings, setOpeningSettings] = useState(false);
  const styles = useStyles();

  async function openSettings() {
    setOpeningSettings(true);
    try { await openLocationSettings(); }
    catch (failure) {
      useUiStore.getState().showToast(
        failure instanceof Error ? failure.message : 'Could not open Settings. Open them manually and allow precise location.',
        'error',
      );
    } finally { setOpeningSettings(false); }
  }

  if (checking) {
    return (
      <View style={styles.checking}>
        <ActivityIndicator size="small" color={theme.colors.accent} />
        <Text style={styles.body}>Checking location access…</Text>
      </View>
    );
  }
  if (permission === 'granted' && !error) return null;

  return (
    <View style={styles.notice}>
      <Text style={styles.title}>Precise location needed</Text>
      <Text style={styles.body}>
        {error ?? (permission === 'blocked'
          ? 'Allow location, including Precise Location, in device Settings. RunTrack only records while open.'
          : 'Allow location to record your route, distance and pace. No background access is requested.')}
      </Text>
      {permission === 'blocked' ? (
        <Button label="Open Settings" variant="secondary" onPress={() => void openSettings()} loading={openingSettings} />
      ) : (
        <Button label="Allow location" variant="secondary" onPress={() => void onRetry()} />
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  checking: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  notice: { gap: t.spacing.sm },
  title: { ...t.typography.title, color: t.colors.text },
  body: { ...t.typography.body, color: t.colors.textSecondary },
}));

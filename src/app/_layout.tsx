import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { bootstrapAuth } from '../api/auth';
import { Screen, Toast } from '../components';
import { purgeSyncedOlderThan } from '../services/db';
import { navigationTheme } from '../navigation/theme';
import { useTrackingLifecycle } from '../services/locationTracking';
import { useAuthStore } from '../stores/authStore';
import { makeStyles, theme } from '../theme';

export default function RootLayout() {
  const initializing = useAuthStore((state) => state.initializing);
  const user = useAuthStore((state) => state.user);
  const styles = useStyles();
  useTrackingLifecycle();

  useEffect(() => {
    bootstrapAuth();
    // #016: expire synced queue rows so the table cannot grow forever. The
    // retry worker (#017) also purges after each sync pass.
    void purgeSyncedOlderThan().catch(() => undefined);
  }, []);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="dark" />
      {initializing ? (
        <Screen padded={false} style={styles.loading}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </Screen>
      ) : (
        <Stack key={user?.uid ?? 'signed-out'} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={user !== null} redirectTo="/(auth)/login">
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          <Stack.Protected guard={user === null} redirectTo="/(tabs)/track">
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      )}
      <Toast />
    </ThemeProvider>
  );
}

const useStyles = makeStyles(() => ({
  loading: { alignItems: 'center', justifyContent: 'center' },
}));

import { Stack } from 'expo-router';
import { stackScreenOptions } from '../../../navigation/theme';

export const unstable_settings = { anchor: 'index' };

export default function TrackLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="active" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="summary" options={{ title: 'Activity review' }} />
    </Stack>
  );
}

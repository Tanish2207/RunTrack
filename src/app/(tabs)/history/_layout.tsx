import { Stack } from 'expo-router';
import { stackScreenOptions } from '../../../navigation/theme';
import { theme } from '../../../theme';

export const unstable_settings = { anchor: 'index' };

export default function HistoryLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{
        title: 'History',
        headerLargeTitleEnabled: true,
        headerLargeTitleStyle: {
          color: theme.colors.text,
          fontSize: theme.typography.display.fontSize,
          fontWeight: theme.typography.display.fontWeight,
        },
        headerLargeStyle: { backgroundColor: theme.colors.card },
        headerLargeTitleShadowVisible: false,
      }} />
      <Stack.Screen name="[activityId]" options={{ title: 'Activity', headerLargeTitleEnabled: false }} />
    </Stack>
  );
}

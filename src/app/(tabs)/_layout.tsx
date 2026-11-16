import { Tabs } from 'expo-router';
import { Icon } from '../../components';
import { stackScreenOptions } from '../../navigation/theme';
import { theme } from '../../theme';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      ...stackScreenOptions,
      headerShown: false,
      tabBarActiveTintColor: theme.colors.accent,
      tabBarInactiveTintColor: theme.colors.muted,
      tabBarStyle: { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border },
      tabBarLabelStyle: theme.typography.caption,
    }}>
      <Tabs.Screen name="track" options={{
        title: 'Track',
        tabBarIcon: ({ color, size }) => <Icon name="map" color={color} size={size} />,
      }} />
      <Tabs.Screen name="history" options={{
        title: 'History',
        tabBarIcon: ({ color, size }) => <Icon name="history" color={color} size={size} />,
      }} />
      <Tabs.Screen name="heatmap" options={{
        title: 'Heatmap', headerShown: true,
        tabBarIcon: ({ color, size }) => <Icon name="fire" color={color} size={size} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profile', headerShown: true,
        tabBarIcon: ({ color, size }) => <Icon name="account-circle" color={color} size={size} />,
      }} />
    </Tabs>
  );
}

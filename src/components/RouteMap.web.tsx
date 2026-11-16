import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { makeStyles, theme } from '../theme';
import { Icon } from './Icon';
import type { RouteMapProps } from './RouteMap.types';

/** Native maps are not supported on web; keep the rest of the UI usable. */
export const RouteMap = memo(function RouteMap(_props: RouteMapProps) {
  const styles = useStyles();
  return (
    <View style={[StyleSheet.absoluteFill, styles.map]}>
      <Icon name="map-outline" size={theme.spacing.xxl} color={theme.colors.muted} />
      <Text style={styles.label}>Route maps are available on Android and iOS.</Text>
    </View>
  );
});

const useStyles = makeStyles((t) => ({
  map: { backgroundColor: t.colors.background, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
  label: { ...t.typography.body, color: t.colors.textSecondary, textAlign: 'center', paddingHorizontal: t.spacing.xl },
}));

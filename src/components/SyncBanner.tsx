import { View } from 'react-native';
import { makeStyles } from '../theme';

/**
 * #017 will fill this reserved single-line footprint: one body line plus two
 * small padding steps (36pt). Keep it mounted for every History list state;
 * there is intentionally no queue, store, network work, or pending-sync UI yet.
 */
export function SyncBanner() {
  const styles = useStyles();
  return (
    <View
      style={styles.slot}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    />
  );
}

const useStyles = makeStyles((t) => ({
  slot: {
    height: t.typography.body.lineHeight + t.spacing.sm * 2,
    minHeight: t.typography.body.lineHeight + t.spacing.sm * 2,
    flexShrink: 0,
  },
}));

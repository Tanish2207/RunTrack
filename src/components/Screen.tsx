import type { ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { makeStyles } from '../theme';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap children in a ScrollView (keyboard-friendly) instead of a static View. */
  scroll?: boolean;
  /** Apply the standard screen padding. Default `true`. */
  padded?: boolean;
  /** Omit edges already handled by an opaque header or the tab bar. */
  edges?: SafeAreaViewProps['edges'];
  /** Applied to the content container (scroll mode) or the inner View. */
  style?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll = false, padded = true, edges = ['top', 'bottom'], style }: ScreenProps) {
  const styles = useStyles();

  if (scroll) {
    return (
      <SafeAreaView style={styles.root} edges={edges}>
        <ScrollView
          style={styles.grow}
          contentContainerStyle={[padded && styles.padded, style]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      <View style={[styles.grow, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.background },
  /** flexGrow (not flex) so content can stretch to fill yet also stay compact. */
  grow: { flexGrow: 1 },
  /** Standard screen padding — 16 all around. */
  padded: { paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.lg },
}));

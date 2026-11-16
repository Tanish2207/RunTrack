import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { makeStyles, spacing, theme, type Theme } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Shows an inline spinner in place of the label while keeping the button width stable. */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Control height = two spacing steps (32 + 16 = 48pt), the comfortable minimum
 * touch target. Constant across all states so toggling `loading` never resizes
 * the button (spec: no layout jumps during async ops).
 */
const CONTROL_HEIGHT = spacing.xxl + spacing.lg;

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const container = useContainerStyles();
  const labels = useLabelStyles();
  const structural = useStructuralStyles();
  const busy = loading || disabled;
  // Filled variants spin in the surface color; outlined/ghost spin in accent.
  const spinnerColor = variant === 'primary' || variant === 'destructive'
    ? theme.colors.card
    : theme.colors.accent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      onPress={busy ? undefined : onPress}
      disabled={busy}
      style={({ pressed }) => [
        container.base,
        container[variant],
        busy && container.dimmed,
        pressed && !busy && container.pressed,
        style,
      ]}
    >
      {loading ? (
        // Invisible label reserves the exact width; spinner is overlaid centered.
        <View style={structural.spinnerHost}>
          <Text style={[labels[variant], structural.reserved]} aria-hidden>
            {label}
          </Text>
          <View style={structural.spinnerOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={spinnerColor} />
          </View>
        </View>
      ) : (
        <Text style={labels[variant]}>{label}</Text>
      )}
    </Pressable>
  );
}

const useContainerStyles = makeStyles((t: Theme) => ({
  base: {
    minHeight: CONTROL_HEIGHT,
    borderRadius: t.radius.full,
    paddingHorizontal: t.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: t.colors.accent },
  secondary: {
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  destructive: { backgroundColor: t.colors.danger },
  ghost: { backgroundColor: 'transparent' },
  dimmed: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
}));

const useLabelStyles = makeStyles((t: Theme) => ({
  primary: { ...t.typography.bodyLg, fontWeight: '600', color: t.colors.card },
  secondary: { ...t.typography.bodyLg, fontWeight: '600', color: t.colors.text },
  destructive: { ...t.typography.bodyLg, fontWeight: '600', color: t.colors.card },
  ghost: { ...t.typography.bodyLg, fontWeight: '600', color: t.colors.accent },
}));

const useStructuralStyles = makeStyles((t: Theme) => ({
  /** Host sized by the invisible label so width stays stable while loading. */
  spinnerHost: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  reserved: { opacity: 0 },
  /** Equivalent of the removed `absoluteFillObject`, expressed explicitly. */
  spinnerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

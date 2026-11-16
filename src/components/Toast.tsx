import { useEffect } from 'react';
import { Animated, Pressable, Text, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUiStore, type ToastType } from '../stores/uiStore';
import { makeStyles, theme } from '../theme';
import { Icon, type IconName } from './Icon';

const TOAST_DURATION_MS = 2500;

const TOAST_ICONS: Record<ToastType, IconName> = {
  success: 'check-circle',
  error: 'alert-circle',
  info: 'information',
};

/**
 * Non-blocking snackbar (spec §6). Mount `<Toast />` ONCE near the app root;
 * any module can then raise feedback via `useUiStore().showToast(...)`.
 *
 * - Fixed near the bottom, above the safe area, over current content.
 * - `pointerEvents="box-none"` on the overlay so it never blocks touches
 *   outside the chip; tapping the chip dismisses it (`clearToast`).
 * - Auto-dismisses after ~2.5s; the timer restarts whenever `toast.key`
 *   changes, so back-to-back toasts each get a full lifetime.
 */
export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const toastKey = toast?.key;
  const appear = useAnimatedValue(0);

  useEffect(() => {
    if (toastKey === undefined) return;
    appear.setValue(0);
    const animation = Animated.timing(appear, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start();
    const timer = setTimeout(clearToast, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [toastKey, clearToast, appear]);

  if (!toast) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[
        styles.overlay,
        {
          bottom: insets.bottom + theme.spacing.lg,
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [theme.spacing.md, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={clearToast}
        style={[styles.chip, styles[toast.type]]}
      >
        <Icon name={TOAST_ICONS[toast.type]} size={18} color={theme.colors.card} />
        <Text style={styles.message}>{toast.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    maxWidth: '90%',
    borderRadius: t.radius.full,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    shadowColor: t.colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  success: { backgroundColor: t.colors.success },
  error: { backgroundColor: t.colors.danger },
  info: { backgroundColor: t.colors.text },
  message: {
    ...t.typography.body,
    fontWeight: '500',
    color: t.colors.card,
    flexShrink: 1,
  },
}));

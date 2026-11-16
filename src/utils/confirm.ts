import { Alert, Platform } from 'react-native';

export function confirmDestructiveAction({ title, message, cancelLabel, confirmLabel, onConfirm, onCancel }: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel?: () => void;
}): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    else onCancel?.();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ], { cancelable: true, onDismiss: onCancel });
}

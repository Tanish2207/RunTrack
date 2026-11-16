import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { makeStyles, theme } from '../theme';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Inline validation message rendered under the input in the danger color (never an Alert). */
  error?: string;
  secureTextEntry?: boolean;
  placeholder?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  keyboardType?: TextInputProps['keyboardType'];
  multiline?: boolean;
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  secureTextEntry,
  placeholder,
  autoCapitalize,
  keyboardType,
  multiline = false,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const styles = useStyles();
  const invalid = typeof error === 'string' && error.length > 0;
  const borderColor = invalid
    ? theme.colors.danger
    : focused
      ? theme.colors.accent
      : theme.colors.border;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, { borderColor }, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        selectionColor={theme.colors.accent}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {invalid ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  label: {
    ...t.typography.caption,
    color: t.colors.text,
    marginBottom: t.spacing.sm,
  },
  input: {
    backgroundColor: t.colors.card,
    borderWidth: 1,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    color: t.colors.text,
    ...t.typography.bodyLg,
  },
  inputMultiline: {
    minHeight: t.typography.bodyLg.lineHeight * 4,
  },
  error: {
    ...t.typography.caption,
    color: t.colors.danger,
    marginTop: t.spacing.xs,
  },
}));

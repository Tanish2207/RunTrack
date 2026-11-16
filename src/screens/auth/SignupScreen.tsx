/**
 * Signup (#006, spec §3.1/§6) — name / email / password / confirm-password
 * form with inline client-side validation and real `signUp()` submission.
 *
 * Flow:
 *  - All four fields are validated BEFORE any Firebase call; invalid input
 *    never leaves the device and renders under the offending field. Errors
 *    clear as the user edits that field.
 *  - `signUp()` (src/api/auth.ts) creates the Auth account AND the
 *    `users/{uid}` doc, then seeds the auth store — the #004 auth gate flips
 *    to Main automatically on success, so there is no manual navigation here.
 *  - Firebase failures come back through `mapFirebaseAuthError`: codes that
 *    name a field we own render inline on that field; everything else
 *    (network / config / unknown — expected while the placeholder Firebase
 *    config is active) surfaces as a non-blocking error toast.
 */

import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { signUp } from '../../api/auth';
import { Button, Icon, Screen, TextField } from '../../components';
import { useUiStore } from '../../stores/uiStore';
import { theme, makeStyles } from '../../theme';
import { mapFirebaseAuthError } from '../../utils/authErrors';
import type { FieldError } from '../../utils/authErrors';

/** Fields owned by this screen (AuthErrorField covers the first three). */
type SignupField = 'name' | 'email' | 'password' | 'confirm';

type SignupValues = Record<SignupField, string>;
type SignupFieldErrors = Partial<Record<SignupField, string>>;

/** Pragmatic email shape: something@something.tld, no whitespace. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches Firebase's own `auth/weak-password` threshold. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Client-side validation — the ONLY gate before any Firebase call. Rules
 * (spec §3.1): name non-empty (trimmed), email regex, password >= 6,
 * confirm matches password.
 */
function validateForm(values: SignupValues): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  if (values.name.trim().length === 0) {
    errors.name = 'Enter your name.';
  }
  if (!EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (values.confirm !== values.password) {
    errors.confirm = 'Passwords do not match.';
  }
  return errors;
}

export default function SignupScreen() {
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const styles = useStyles();

  const [values, setValues] = useState<SignupValues>({
    name: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<SignupFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const setFieldError = (field: SignupField, message: string | undefined) => {
    setErrors((prev) => {
      const next: SignupFieldErrors = { ...prev };
      if (field === 'name') next.name = message;
      else if (field === 'email') next.email = message;
      else if (field === 'password') next.password = message;
      else next.confirm = message;
      return next;
    });
  };

  /** Per-field editor: writes the value and clears that field's error. */
  const handleChange = (field: SignupField) => (text: string) => {
    setValues((prev) => {
      const next: SignupValues = { ...prev };
      if (field === 'name') next.name = text;
      else if (field === 'email') next.email = text;
      else if (field === 'password') next.password = text;
      else next.confirm = text;
      return next;
    });
    setFieldError(field, undefined);
  };

  /**
   * Inline where the kit's mapping names a field we own; toast otherwise
   * (network / config / unknown errors have no natural field). `name` never
   * comes back from Firebase but is routed like the other fields anyway.
   */
  const applyAuthError = (error: FieldError) => {
    if (error.field === 'general') {
      showToast(error.message, 'error');
      return;
    }
    setFieldError(error.field, error.message);
  };

  const handleSubmit = async () => {
    if (submitting) return; // double-submit guard

    const nextErrors = validateForm(values);
    setErrors(nextErrors);
    if (
      nextErrors.name !== undefined ||
      nextErrors.email !== undefined ||
      nextErrors.password !== undefined ||
      nextErrors.confirm !== undefined
    ) {
      return; // invalid input never reaches Firebase
    }

    setSubmitting(true);
    try {
      // Creates the Auth user + users/{uid} doc and seeds the auth store;
      // the #004 gate switches to Main on its own — no manual navigation.
      await signUp(values.name.trim(), values.email.trim(), values.password);
    } catch (err) {
      applyAuthError(mapFirebaseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll style={styles.content}>
      <KeyboardAvoidingView
        // iOS pads above the keyboard; Android defers to adjustResize, where
        // 'height' is effectively a no-op but keeps the contract explicit.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.form}
      >
        <View style={styles.header}>
          <View style={styles.logoBubble}>
            <Icon name="run-fast" size={28} color={theme.colors.card} />
          </View>
          <Text style={styles.appName}>RunTrack</Text>
          <Text style={styles.tagline}>Start your streak today.</Text>
        </View>

        <TextField
          label="Full name"
          value={values.name}
          onChangeText={handleChange('name')}
          placeholder="Jane Doe"
          autoCapitalize="words"
          error={errors.name}
        />
        <TextField
          label="Email"
          value={values.email}
          onChangeText={handleChange('email')}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />
        <TextField
          label="Password"
          value={values.password}
          onChangeText={handleChange('password')}
          placeholder="••••••••"
          secureTextEntry
          error={errors.password}
        />
        <TextField
          label="Confirm password"
          value={values.confirm}
          onChangeText={handleChange('confirm')}
          placeholder="••••••••"
          secureTextEntry
          error={errors.confirm}
        />

        <Button
          label="Create Account"
          onPress={() => void handleSubmit()}
          loading={submitting}
          disabled={submitting}
        />

        <Pressable
          accessibilityRole="link"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.link}
        >
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.linkAccent}>Log in</Text>
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  /** Grows to fill so the form centers vertically, like Login (#007). */
  content: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  form: {
    gap: t.spacing.lg,
  },
  header: {
    alignItems: 'center',
    gap: t.spacing.sm,
    marginBottom: t.spacing.md,
  },
  logoBubble: {
    width: t.spacing.xxl * 2,
    height: t.spacing.xxl * 2,
    borderRadius: t.radius.full,
    backgroundColor: t.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    ...t.typography.display,
    color: t.colors.text,
  },
  tagline: {
    ...t.typography.body,
    color: t.colors.textSecondary,
  },
  link: {
    alignItems: 'center',
    paddingVertical: t.spacing.sm,
  },
  linkText: {
    ...t.typography.body,
    color: t.colors.textSecondary,
  },
  linkAccent: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.colors.accent,
  },
}));

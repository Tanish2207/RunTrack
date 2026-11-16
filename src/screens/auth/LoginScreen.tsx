/**
 * Login screen (ticket #007, spec §3.1/§6).
 *
 * Real sign-in flow: client-side validation BEFORE any Firebase call
 * (email format + password non-empty, inline under the exact field and
 * cleared as the user edits), then `signIn` with a loading + double-submit
 * guard. Firebase errors are mapped to inline field errors via
 * `mapFirebaseAuthError`; 'general' codes surface as a toast — never an
 * Alert. On success the root layout's auth guard redirects to Track.
 *
 * Layout note: KeyboardAvoidingView wraps the whole screen so inline errors
 * stay visible above the keyboard on small displays (padding on iOS —
 * Android's default adjustResize already handles the keyboard).
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { devSignIn, signIn } from '../../api/auth';
import { Button, Icon, Screen, TextField } from '../../components';
import { theme, makeStyles } from '../../theme';
import { useUiStore } from '../../stores/uiStore';
import { mapFirebaseAuthError } from '../../utils/authErrors';

/** Pragmatic "local@domain.tld" shape check — Firebase has the final say. */
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export default function LoginScreen() {
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const styles = useStyles();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (busy) return; // double-submit guard

    // Client-side validation first — no network call with an invalid form.
    const cleanEmail = email.trim();
    const nextEmailError =
      cleanEmail.length === 0
        ? 'Enter your email.'
        : EMAIL_PATTERN.test(cleanEmail)
          ? undefined
          : 'Enter a valid email address.';
    const nextPasswordError =
      password.trim().length === 0 ? 'Enter your password.' : undefined;
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError !== undefined || nextPasswordError !== undefined) return;

    setBusy(true);
    try {
      await signIn(cleanEmail, password);
      // Success: the root layout's auth gate reacts to authStore.user — no
      // navigation needed here.
    } catch (err: unknown) {
      const mapped = mapFirebaseAuthError(err);
      if (mapped.field === 'email') setEmailError(mapped.message);
      else if (mapped.field === 'password') setPasswordError(mapped.message);
      else showToast(mapped.message, 'error'); // 'general' → non-blocking toast
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.avoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen scroll>
        <View style={styles.body}>
          <View style={styles.header}>
            <View style={styles.logoBubble}>
              <Icon name="run-fast" size={28} color={theme.colors.card} />
            </View>
            <Text style={styles.appName}>RunTrack</Text>
            <Text style={styles.tagline}>Track your runs. Keep your streaks.</Text>
          </View>

          <TextField
            label="Email"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setEmailError(undefined); // clear inline errors as the user edits
            }}
            error={emailError}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setPasswordError(undefined); // clear inline errors as the user edits
            }}
            error={passwordError}
            placeholder="••••••••"
            secureTextEntry
          />

          <Button label="Login" onPress={handleSubmit} loading={busy} />

          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/(auth)/signup')}
            style={styles.link}
          >
            <Text style={styles.linkText}>
              Don&apos;t have an account? <Text style={styles.linkAccent}>Sign up</Text>
            </Text>
          </Pressable>
        </View>

        {__DEV__ ? (
          // __DEV__-only escape hatch into Main before real Firebase keys are
          // pasted (no network involved) — removed in #028 cleanup.
          <Button
            variant="ghost"
            label="Dev sign-in"
            onPress={devSignIn}
            style={styles.devButton}
          />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((t) => ({
  avoid: { flex: 1 },
  /** Grows to fill the screen and centers the form; dev button stays pinned below. */
  body: {
    flexGrow: 1,
    justifyContent: 'center',
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
  devButton: {
    alignSelf: 'center',
    paddingHorizontal: t.spacing.lg,
    marginTop: t.spacing.xl,
    marginBottom: t.spacing.xs,
  },
}));

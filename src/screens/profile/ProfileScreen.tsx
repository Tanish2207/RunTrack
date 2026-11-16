/**
 * Placeholder Profile — owned by ticket #022 (stats, initials avatar, weight
 * and settings land there).
 *
 * Carries #004's other half of the dev-only preview toggle: a __DEV__-only
 * "Dev sign-out" ghost button (removed with the toggle in #028). The profile
 * name is read from the auth store so #007's bootstrap acceptance check
 * ("name shows on Profile placeholder") passes today.
 */

import { devSignOut } from '../../api/auth';
import { Button, Card, EmptyState, Screen } from '../../components';
import { useAuthStore } from '../../stores/authStore';
import { makeStyles } from '../../theme';

export default function ProfileScreen() {
  const name = useAuthStore((s) => s.profile?.name ?? null);
  const styles = useStyles();

  return (
    <Screen edges={[]}>
      <Card>
        <EmptyState
          icon="account-circle"
          title={name ?? 'Your profile'}
          message="Streaks, badges, weight and settings land in #022."
        />
        {__DEV__ ? (
          <Button variant="ghost" label="Dev sign-out" onPress={devSignOut} style={styles.dev} />
        ) : null}
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  dev: { marginTop: t.spacing.sm },
}));

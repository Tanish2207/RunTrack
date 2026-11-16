import { ActivityIndicator, Text, View } from 'react-native';
import { makeStyles, theme } from '../theme';
import { Card } from './Card';
import { Icon } from './Icon';

export type AiSummaryCardProps =
  | { state: 'hidden' }
  | { state: 'loading' }
  | { state: 'ready'; summary: string };

/** Reserved review slot; the real recap hook is deliberately deferred to #019. */
export function AiSummaryCard(props: AiSummaryCardProps) {
  const styles = useStyles();
  if (props.state === 'hidden') {
    return <View style={styles.slot} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  }
  return (
    <Card style={styles.slot}>
      <View style={styles.heading}>
        <Icon name="creation" color={theme.colors.accent} />
        <Text style={styles.title}>Workout recap</Text>
      </View>
      {props.state === 'loading' ? (
        <View style={styles.heading}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.body}>Writing your recap…</Text>
        </View>
      ) : <Text style={styles.body}>{props.summary}</Text>}
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  slot: { minHeight: t.spacing.xxl * 3, gap: t.spacing.sm },
  heading: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  title: { ...t.typography.title, color: t.colors.text },
  body: { ...t.typography.body, color: t.colors.textSecondary },
}));

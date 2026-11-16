/**
 * Placeholder Heatmap — owned by ticket #025 (aggregated route heatmap across
 * all activities lands there).
 */

import { Card, EmptyState, Screen } from '../../components';

export default function HeatmapScreen() {
  return (
    <Screen edges={[]}>
      <Card>
        <EmptyState
          // Ticket names the 'heatmap' glyph; it's absent from the icon family,
          // so 'fire' stands in until #025 picks a final mark.
          icon="fire"
          title="Your heatmap"
          message="Route aggregation across every activity lands in #025."
        />
      </Card>
    </Screen>
  );
}

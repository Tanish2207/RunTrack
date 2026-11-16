import { expect, it } from 'vitest';

import type { ActivityInput } from '../../api/types';
import { generateAndAttachSummary } from '../aiSummary';
import { recomputeUserAfterActivity } from '../gamification';

it('exports awaited no-op hooks without changing the input', async () => {
  const input: ActivityInput = {
    userId: 'owner', type: 'walk', startTime: 0, endTime: 1000, durationSec: 1,
    distanceKm: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0, route: [],
  };
  const before = { ...input, route: [...input.route] };
  await expect(recomputeUserAfterActivity('owner', input, 'id')).resolves.toBeUndefined();
  await expect(generateAndAttachSummary('id', input)).resolves.toBeUndefined();
  expect(input).toEqual(before);
});

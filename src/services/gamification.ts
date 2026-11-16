import type { ActivityInput } from '../api/types';

/** No-op extension point; tickets #020/#021 add badge/streak/profile updates. */
export async function recomputeUserAfterActivity(
  userId: string,
  input: ActivityInput,
  activityId: string,
): Promise<void> {
  void userId;
  void input;
  void activityId;
}

import type { ActivityInput } from '../api/types';

/** No-op extension point; #019 adds a server-side callable, never a client key. */
export async function generateAndAttachSummary(
  activityId: string,
  input: ActivityInput,
): Promise<void> {
  void activityId;
  void input;
}

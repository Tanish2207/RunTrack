/** Connectivity gate shared by the save flow (#016) and the retry worker (#017). */
import NetInfo from '@react-native-community/netinfo';

/**
 * `isInternetReachable` is `null` when reachability is unknown (e.g. VPN or a
 * network type without probes); attempting the push anyway is the safe default
 * because a failure just leaves the row queued for #017.
 */
export async function isInternetLikelyReachable(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isInternetReachable !== false;
}

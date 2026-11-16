import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, ActivityType } from '../../../api/types';
import type { ActivityDetailResult, ActivityDetailState } from '../../../hooks/useActivityDetail';
import type { Theme } from '../../../theme';
import { colors, radius, spacing } from '../../../theme/tokens';
import ActivityDetailScreen from '../ActivityDetailScreen';

type InspectedElement = ReactElement<Record<string, unknown>>;
type ActivityIdParam = string | string[] | undefined;

/**
 * JSX orchestration only: child components/native maps and the Expo navigator
 * are not rendered. The real hook's owner/focus/request races are covered in
 * src/hooks/__tests__/useActivityDetail.test.ts; this file tests its UI contract.
 */
const memo = vi.hoisted(() => {
  const values: { value: unknown; deps: readonly unknown[] }[] = [];
  let index = 0;
  return {
    useMemo: <T,>(build: () => T, deps: readonly unknown[]): T => {
      const position = index++;
      const previous = values[position];
      if (!previous || previous.deps.length !== deps.length ||
        deps.some((value, dependency) => !Object.is(value, previous.deps[dependency]))) {
        values[position] = { value: build(), deps };
      }
      return values[position].value as T;
    },
    beginRender: () => { index = 0; },
    reset: () => { index = 0; values.length = 0; },
  };
});

const mocks = vi.hoisted(() => ({
  params: { activityId: 'saved-id' as ActivityIdParam },
  state: { status: 'loading' } as ActivityDetailState,
  useActivityDetail: vi.fn<(id: ActivityIdParam) => ActivityDetailResult>(),
  retry: vi.fn<() => void>(),
  isCurrent: vi.fn<() => boolean>(),
  dismissTo: vi.fn<(href: string) => void>(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: memo.useMemo,
}));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View' }));
vi.mock('expo-router', () => ({
  Stack: { Screen: 'Stack.Screen' },
  useLocalSearchParams: () => mocks.params,
  useRouter: () => ({ dismissTo: mocks.dismissTo }),
}));
vi.mock('../../../components', () => ({
  ACTIVITY_LABELS: { run: 'Run', cycle: 'Cycle', walk: 'Walk' },
  AiSummaryCard: 'AiSummaryCard', Button: 'Button', Card: 'Card', EmptyState: 'EmptyState',
  Icon: 'Icon', RouteMap: 'RouteMap', Screen: 'Screen', StatTile: 'StatTile',
}));
vi.mock('../../../hooks/useActivityDetail', () => ({ useActivityDetail: mocks.useActivityDetail }));
vi.mock('../../../theme', async () => {
  const { colors, radius, spacing, typography } = await import('../../../theme/tokens');
  const theme = { colors, radius, spacing, typography };
  return {
    theme,
    makeStyles: <T,>(build: (tokens: Theme) => T) => {
      const styles = build(theme);
      return () => styles;
    },
  };
});

function activity(type: ActivityType = 'run'): Activity {
  return {
    id: 'saved-id', userId: 'owner', type,
    startTime: new Date(2026, 10, 10, 7, 2).getTime(), endTime: new Date(2026, 10, 10, 8, 15).getTime(),
    durationSec: 3725, distanceKm: 5.126, avgPaceSecPerKm: 342, caloriesEstimate: 362.6,
    route: [
      { lat: 10, lng: 20, timestamp: 1000, speed: 2.5 },
      { lat: 10.01, lng: 20.01, timestamp: 3000 },
      { lat: 11, lng: 21, timestamp: 120_000, speed: 0 },
      { lat: 11.01, lng: 21.01, timestamp: 122_000 },
    ],
    aiSummary: '  The exact stored recap.\nA second saved line.  ',
  };
}

function render(): ReactElement {
  memo.beginRender();
  return ActivityDetailScreen();
}

function elements(tree: unknown): InspectedElement[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}

function nodes(tree: unknown, type: string): InspectedElement[] {
  return elements(tree).filter((element) => element.type === type);
}

function requiredNode(tree: unknown, type: string, label?: string): InspectedElement {
  const found = nodes(tree, type).find((element) => label === undefined || element.props.label === label);
  if (!found) throw new Error(`Expected ${type}${label ? ` labelled ${label}` : ''}.`);
  return found;
}

function textContent(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  return isValidElement<Record<string, unknown>>(tree) ? textContent(tree.props.children) : '';
}

function onPress(tree: unknown, label: string): () => void {
  const callback = requiredNode(tree, 'Button', label).props.onPress;
  if (typeof callback !== 'function') throw new Error(`Expected an onPress for ${label}.`);
  return callback as () => void;
}

function title(tree: unknown): unknown {
  const options = requiredNode(tree, 'Stack.Screen').props.options;
  if (typeof options !== 'object' || options === null || !('title' in options)) {
    throw new Error('Expected a header title option.');
  }
  return options.title;
}

beforeEach(() => {
  vi.resetAllMocks();
  memo.reset();
  mocks.params = { activityId: 'saved-id' };
  mocks.state = { status: 'loading' };
  mocks.isCurrent.mockReturnValue(true);
  mocks.useActivityDetail.mockImplementation(() => ({ state: mocks.state, retry: mocks.retry, isCurrent: mocks.isCurrent }));
});

describe('ActivityDetailScreen stored content', () => {
  it('uses a small section spinner while loading, with a safe generic title and a way back', () => {
    const tree = render();
    expect(requiredNode(tree, 'Screen').props).toMatchObject({ scroll: true, edges: [] });
    expect(requiredNode(tree, 'ActivityIndicator').props).toMatchObject({ size: 'small', color: colors.accent });
    expect(nodes(tree, 'View').some(({ props }) => props.accessibilityRole === 'progressbar' &&
      props.accessibilityLabel === 'Loading saved activity')).toBe(true);
    expect(textContent(tree)).toContain('Loading saved activity…');
    expect(title(tree)).toBe('Activity');
    expect(nodes(tree, 'EmptyState')).toEqual([]);
    expect(nodes(tree, 'RouteMap')).toEqual([]);
    expect(nodes(tree, 'StatTile')).toEqual([]);
    expect(nodes(tree, 'AiSummaryCard')).toEqual([]);
    onPress(tree, 'Back to History')();
    expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith('/(tabs)/history');
  });

  it.each<[ActivityType, string, string]>([['run', 'Run', 'run-fast'], ['cycle', 'Cycle', 'bike'], ['walk', 'Walk', 'walk']])(
    'shows the exact saved %s route, stats, badge, local date/title, and stored recap', (type, label, icon) => {
      const source = activity(type);
      const original = structuredClone(source);
      mocks.state = { status: 'ready', activity: source };
      const tree = render();
      expect(textContent(tree)).toContain(label);
      expect(textContent(tree)).toContain('Tue, Nov 10 · 7:02 AM');
      expect(title(tree)).toBe(`${label} · Nov 10, 2026`);
      expect(nodes(tree, 'View').some(({ props }) => props.accessible === true && props.accessibilityLabel === `${label} activity`)).toBe(true);
      expect(nodes(tree, 'Icon').find(({ props }) => props.name === icon)?.props).toMatchObject({ size: spacing.xl, color: colors.accent });
      const map = requiredNode(tree, 'RouteMap');
      expect(map.key).toBe(source.id);
      expect(map.props).toMatchObject({ fitRoute: true, interactive: true, showsUserLocation: false, follow: false });
      expect(map.props.segments).toEqual([source.route]);
      expect((map.props.segments as Activity['route'][])[0]).toBe(source.route);
      expect(map.props).not.toHaveProperty('onLocationChange');
      expect(map.props).not.toHaveProperty('currentPoint');
      expect(nodes(tree, 'View').some(({ props }) => {
        const style = props.style as Record<string, unknown> | undefined;
        return style?.aspectRatio === 1.5 && style.width === '100%' && style.overflow === 'hidden' &&
          style.borderRadius === radius.md && style.backgroundColor === colors.card;
      })).toBe(true);
      expect(nodes(tree, 'StatTile').map(({ props }) => [props.label, props.value])).toEqual([
        ['Distance', '5.13 km'], ['Duration', '1:02:05'], ['Avg pace', '5:42 /km'], ['Est. calories', '363 kcal'],
      ]);
      expect(requiredNode(tree, 'AiSummaryCard').props).toMatchObject({ state: 'ready', summary: source.aiSummary });
      expect(nodes(tree, 'Button').map(({ props }) => props.label)).toEqual(['Back to History']);
      expect(nodes(tree, 'EmptyState')).toEqual([]);
      expect(nodes(tree, 'ActivityIndicator')).toEqual([]);
      expect(source).toEqual(original);
    },
  );

  it('memoizes one flat persisted segment instead of inferring pause breaks from time gaps', () => {
    const source = activity();
    mocks.state = { status: 'ready', activity: source };
    const initial = requiredNode(render(), 'RouteMap');
    const repeated = requiredNode(render(), 'RouteMap');
    expect(repeated.props.segments).toBe(initial.props.segments);
    mocks.state = { status: 'ready', activity: { ...source, aiSummary: 'New stored recap with the same route object.' } };
    expect(requiredNode(render(), 'RouteMap').props.segments).toBe(initial.props.segments);
    const replacement = { ...source, id: 'next-id', route: source.route.slice(0, 1) };
    mocks.state = { status: 'ready', activity: replacement };
    const next = requiredNode(render(), 'RouteMap');
    expect(next.key).toBe('next-id');
    expect(next.props.segments).not.toBe(initial.props.segments);
    expect(next.props.segments).toEqual([replacement.route]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE])(
    'keeps the current type and safely labels an invalid stored date (%s)', (startTime) => {
      mocks.state = { status: 'ready', activity: { ...activity(), startTime } };
      const tree = render();
      expect(title(tree)).toBe('Run · Date unavailable');
      expect(textContent(tree)).toContain('Date unavailable');
      expect(nodes(tree, 'StatTile')).toHaveLength(4);
      expect(nodes(tree, 'RouteMap')).toHaveLength(1);
    },
  );

  it('shows an honest empty-route notice instead of a misleading map, while retaining stored zero stats', () => {
    mocks.state = {
      status: 'ready',
      activity: { ...activity('walk'), route: [], aiSummary: undefined, distanceKm: 0, durationSec: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0 },
    };
    const tree = render();
    expect(textContent(tree)).toContain('No route points were saved for this activity.');
    expect(nodes(tree, 'RouteMap')).toEqual([]);
    expect(nodes(tree, 'StatTile').map(({ props }) => props.value)).toEqual(['0.00 km', '0:00:00', '—', '0 kcal']);
    expect(title(tree)).toBe('Walk · Nov 10, 2026');
    expect(nodes(tree, 'AiSummaryCard')).toEqual([]);
  });

  it('passes a single saved point through for the shared map Start marker without inventing a route', () => {
    const source = activity();
    source.route = source.route.slice(0, 1);
    mocks.state = { status: 'ready', activity: source };
    const tree = render();
    expect(requiredNode(tree, 'RouteMap').props.segments).toEqual([source.route]);
    expect(textContent(tree)).not.toContain('No route points');
    expect(requiredNode(tree, 'RouteMap').props.showsUserLocation).toBe(false);
  });

  it.each([undefined, '', ' \t\n '])('omits the recap entirely when the saved summary is absent/blank: %s', (aiSummary) => {
    mocks.state = { status: 'ready', activity: { ...activity(), aiSummary } };
    const tree = render();
    expect(nodes(tree, 'AiSummaryCard')).toEqual([]);
    expect(nodes(tree, 'ActivityIndicator')).toEqual([]);
    expect(textContent(tree)).not.toContain('Writing your recap');
  });
});

describe('ActivityDetailScreen fallbacks and actions', () => {
  it('shows non-revealing not-found content without a raw ID, stats, recap, or retry', () => {
    mocks.params.activityId = 'private-raw-id';
    mocks.state = { status: 'not-found' };
    const tree = render();
    const empty = requiredNode(tree, 'EmptyState');
    expect(empty.props).toMatchObject({ title: 'Activity not found', message: 'This activity is not available. Return to History to choose another saved activity.' });
    expect(JSON.stringify(empty.props)).not.toContain('private-raw-id');
    expect(textContent(tree)).not.toContain('private-raw-id');
    expect(title(tree)).toBe('Activity');
    expect(nodes(tree, 'RouteMap')).toEqual([]);
    expect(nodes(tree, 'StatTile')).toEqual([]);
    expect(nodes(tree, 'AiSummaryCard')).toEqual([]);
    expect(nodes(tree, 'Button').map(({ props }) => props.label)).toEqual(['Back to History']);
    onPress(tree, 'Back to History')();
    expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith('/(tabs)/history');
  });

  it('offers a signed-out fallback and History rather than showing another account activity', () => {
    mocks.state = { status: 'signed-out' };
    const tree = render();
    expect(requiredNode(tree, 'EmptyState').props).toMatchObject({ title: 'Sign in to view activities' });
    expect(String(requiredNode(tree, 'EmptyState').props.message)).toContain('after you sign in');
    expect(title(tree)).toBe('Activity');
    expect(nodes(tree, 'RouteMap')).toEqual([]);
    expect(nodes(tree, 'Button').map(({ props }) => props.label)).toEqual(['Back to History']);
    onPress(tree, 'Back to History')();
    expect(mocks.dismissTo).toHaveBeenCalledExactlyOnceWith('/(tabs)/history');
  });

  it('shows an accessible inline failure with hook-owned Retry and Back to History', () => {
    mocks.state = { status: 'error', message: 'Check your connection and try again.' };
    const tree = render();
    expect(requiredNode(tree, 'EmptyState').props).toMatchObject({ title: 'Could not load activity', message: 'Check your connection and try again.' });
    expect(nodes(tree, 'View').some(({ props }) => props.accessibilityRole === 'alert')).toBe(true);
    expect(title(tree)).toBe('Activity');
    expect(nodes(tree, 'Button').map(({ props }) => props.label)).toEqual(['Retry', 'Back to History']);
    expect(requiredNode(tree, 'Button', 'Retry').props.onPress).toBe(mocks.retry);
    onPress(tree, 'Retry')();
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.dismissTo).not.toHaveBeenCalled();
    mocks.state = { status: 'loading' };
    expect(nodes(render(), 'Button').map(({ props }) => props.label)).toEqual(['Back to History']);
    mocks.state = { status: 'ready', activity: activity() };
    expect(title(render())).toBe('Run · Nov 10, 2026');
  });

  it.each([
    { status: 'loading' }, { status: 'signed-out' }, { status: 'not-found' },
    { status: 'error', message: 'Try again.' },
  ] satisfies ActivityDetailState[])('never retains the previous activity/title when the current hook state is $status', (state) => {
    mocks.state = { status: 'ready', activity: activity('cycle') };
    expect(title(render())).toBe('Cycle · Nov 10, 2026');
    mocks.params.activityId = 'changed-id';
    mocks.state = state;
    const tree = render();
    expect(title(tree)).toBe('Activity');
    expect(textContent(tree)).not.toContain('Cycle');
    expect(textContent(tree)).not.toContain('Tue, Nov 10');
    expect(nodes(tree, 'RouteMap')).toEqual([]);
    expect(nodes(tree, 'StatTile')).toEqual([]);
    expect(nodes(tree, 'AiSummaryCard')).toEqual([]);
  });

  it.each([undefined, [], ['saved-id'], ['one', 'two'], '', 'folder/id'] as ActivityIdParam[])(
    'forwards URL parameters unchanged to the validating hook: %s', (activityId) => {
      mocks.params.activityId = activityId;
      mocks.state = { status: 'not-found' };
      render();
      expect(mocks.useActivityDetail).toHaveBeenCalledExactlyOnceWith(activityId);
    },
  );

  it('does not navigate from a handler whose hook scope is no longer current', () => {
    mocks.state = { status: 'ready', activity: activity() };
    const staleBack = onPress(render(), 'Back to History');
    mocks.isCurrent.mockReturnValue(false);
    mocks.state = { status: 'loading' };
    mocks.params.activityId = 'new-id';
    render();
    staleBack();
    expect(mocks.dismissTo).not.toHaveBeenCalled();
    expect(mocks.isCurrent).toHaveBeenCalledOnce();
  });
});

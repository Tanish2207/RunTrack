import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Activity, ActivityType } from '../../api/types';
import { theme, type Theme } from '../../theme';
import { ActivityRow, type ActivityRowProps } from '../ActivityRow';

type InspectedElement = ReactElement<Record<string, unknown>>;

vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('../Card', () => ({ Card: 'Card' }));
vi.mock('../Icon', () => ({ Icon: 'Icon' }));
vi.mock('../ActivityTypeSelector', () => ({ ACTIVITY_LABELS: { run: 'Run', cycle: 'Cycle', walk: 'Walk' } }));
vi.mock('../../theme', async () => {
  const { colors, spacing, radius, typography } = await import('../../theme/tokens');
  const theme = { colors, spacing, radius, typography };
  return {
    theme,
    makeStyles: <T,>(build: (theme: Theme) => T) => {
      const styles = build(theme);
      return () => styles;
    },
  };
});

function activity(type: ActivityType): Activity {
  return {
    id: 'saved-id', userId: 'owner', type,
    startTime: new Date(2026, 10, 10, 7, 2).getTime(), endTime: new Date(2026, 10, 10, 8, 4, 5).getTime(),
    distanceKm: 5.126, durationSec: 3725, avgPaceSecPerKm: 342, caloriesEstimate: 362.6,
    route: [{ lat: 10, lng: 20, timestamp: 1000 }], aiSummary: 'Stored recap',
  };
}

function elements(tree: unknown): InspectedElement[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}

function nodes(tree: unknown, type: string): InspectedElement[] {
  return elements(tree).filter((element) => element.type === type);
}

function row(source: Activity, onPress = vi.fn()): ReactElement {
  // Inspect the memoized component's JSX without claiming native rendering.
  const component = ActivityRow as unknown as { type: (props: ActivityRowProps) => ReactElement };
  return component.type({ activity: source, onPress });
}

describe('ActivityRow', () => {
  it('is memoized with the default props comparison', () => {
    const component = ActivityRow as unknown as { $$typeof: symbol; compare: unknown };
    expect(component.$$typeof).toBe(Symbol.for('react.memo'));
    expect(component.compare).toBeNull();
  });

  it.each<[ActivityType, string, string]>([['run', 'Run', 'run-fast'], ['cycle', 'Cycle', 'bike'], ['walk', 'Walk', 'walk']])(
    'uses the %s label/icon and shared date/distance/duration/pace formatting', (type, label, icon) => {
      const source = activity(type);
      const original = structuredClone(source);
      const tree = row(source);
      expect(nodes(tree, 'Text').map(({ props }) => props.children)).toEqual([
        label, 'Tue, Nov 10 · 7:02 AM', '5.13 km', 'Distance', '1:02:05', 'Duration', '5:42 /km', 'Avg pace',
      ]);
      expect(nodes(tree, 'Icon').map(({ props }) => props.name)).toEqual([icon, 'chevron-right']);
      expect(nodes(tree, 'Card')).toHaveLength(1);
      expect(source).toEqual(original);
    },
  );

  it('provides an accessible row action and hides decorative glyphs from assistive technology', () => {
    const onPress = vi.fn();
    const tree = row(activity('run'), onPress);
    const target = nodes(tree, 'Pressable')[0];
    expect(target.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'button',
      accessibilityLabel: 'Run, Tue, Nov 10 · 7:02 AM, distance 5.13 km, duration 1:02:05, average pace 5:42 /km',
      accessibilityHint: 'Opens the saved activity details',
    });
    expect(target.props.onPress).toBe(onPress);
    (target.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
    expect(nodes(tree, 'View').filter(({ props }) => props.accessibilityElementsHidden)).toHaveLength(2);
    expect(nodes(tree, 'View').filter(({ props }) => props.accessibilityElementsHidden)
      .every(({ props }) => props.importantForAccessibility === 'no-hide-descendants')).toBe(true);
  });

  it('uses token-sized touch targets and wrapping stats without truncation or fixed text heights', () => {
    const tree = row(activity('cycle'));
    const pressStyle = nodes(tree, 'Pressable')[0].props.style as (state: { pressed: boolean }) => unknown[];
    expect(pressStyle({ pressed: false })[0]).toMatchObject({
      minHeight: theme.spacing.xxl + theme.spacing.lg, borderRadius: theme.radius.md,
    });
    expect(pressStyle({ pressed: true })[1]).toMatchObject({ opacity: 0.85 });
    const styles = nodes(tree, 'View').map(({ props }) => props.style as Record<string, unknown> | undefined);
    expect(styles.some((style) => style?.flexDirection === 'row' && style.flexWrap === 'wrap')).toBe(true);
    expect(styles.filter((style) => style?.flexBasis === theme.spacing.xxl * 3)).toHaveLength(3);
    expect(nodes(tree, 'Text').every(({ props }) => props.numberOfLines === undefined && props.allowFontScaling !== false)).toBe(true);
    expect(nodes(tree, 'Text').every(({ props }) => (props.style as Record<string, unknown>).height === undefined)).toBe(true);
  });

  it('honestly displays zero distance/duration and unknown pace without inferring stats from the route', () => {
    const source = { ...activity('walk'), distanceKm: 0, durationSec: 0, avgPaceSecPerKm: 0 };
    const tree = row(source);
    expect(nodes(tree, 'Text').map(({ props }) => props.children)).toContain('0.00 km');
    expect(nodes(tree, 'Text').map(({ props }) => props.children)).toContain('0:00:00');
    expect(nodes(tree, 'Text').map(({ props }) => props.children)).toContain('—');
  });
});

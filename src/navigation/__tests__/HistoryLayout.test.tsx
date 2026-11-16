import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import HistoryLayout, { unstable_settings } from '../../app/(tabs)/history/_layout';

vi.mock('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: 'Stack.Screen' }) }));
vi.mock('../theme', () => ({ stackScreenOptions: { headerTransparent: false } }));
vi.mock('../../theme', () => ({
  theme: {
    colors: { text: 'text', card: 'card' },
    typography: { display: { fontSize: 32, fontWeight: '800' } },
  },
}));

type InspectedElement = ReactElement<Record<string, unknown>>;

function screen(name: string): InspectedElement {
  const tree = HistoryLayout();
  const children = tree.props.children as unknown[];
  const found = children.find((child) =>
    isValidElement<Record<string, unknown>>(child) && child.props.name === name,
  );
  if (!isValidElement<Record<string, unknown>>(found)) throw new Error(`Expected ${name} route options.`);
  return found;
}

/** Static Router configuration assertions, not navigation/native-header tests. */
describe('History stack configuration', () => {
  it('retains the History index anchor for detail links', () => {
    expect(unstable_settings).toEqual({ anchor: 'index' });
  });

  it('enables the themed native large title only on History', () => {
    expect(screen('index').props.options).toMatchObject({
      title: 'History', headerLargeTitleEnabled: true,
      headerLargeTitleStyle: { color: 'text', fontSize: 32, fontWeight: '800' },
      headerLargeStyle: { backgroundColor: 'card' },
    });
  });

  it('keeps a non-large generic Detail fallback until current-owner data loads', () => {
    expect(screen('[activityId]').props.options).toEqual({
      title: 'Activity', headerLargeTitleEnabled: false,
    });
  });
});

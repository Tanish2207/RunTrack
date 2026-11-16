import { describe, expect, it, vi } from 'vitest';

import { theme, type Theme } from '../../theme';
import { SyncBanner } from '../SyncBanner';

vi.mock('react-native', () => ({ View: 'View' }));
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

describe('SyncBanner reserved slot', () => {
  it('always returns the same nonzero single-line footprint without pending-sync UI', () => {
    const first = SyncBanner();
    const second = SyncBanner();
    const footprint = theme.typography.body.lineHeight + theme.spacing.sm * 2;
    expect(first.type).toBe('View');
    expect(first.props.children).toBeUndefined();
    expect(first.props.style).toMatchObject({ height: footprint, minHeight: footprint, flexShrink: 0 });
    expect(footprint).toBeGreaterThan(0);
    expect(first.props.style.display).toBeUndefined();
    expect(second.props.style).toBe(first.props.style);
  });

  it('is non-interactive and hidden from iOS, Android, and web accessibility', () => {
    expect(SyncBanner().props).toMatchObject({
      pointerEvents: 'none', accessible: false, accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true,
    });
  });
});
